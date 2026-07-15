import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const allowedOrigin = "http://localhost:3000";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(check, attempts = 60) {
  for (let index = 0; index < attempts; index += 1) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Bridge state");
}

test("protects the local Bridge with origin and pairing, then persists task chat", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "codex-office-bridge-test-"));
  const project = path.join(directory, "external-project");
  const history = path.join(directory, "codex-home", "office", "history.json");
  await mkdir(project, { recursive: true });
  const outsideSecret = path.join(directory, "outside-secret.md");
  await writeFile(outsideSecret, "SYMLINK_ESCAPE_SECRET", "utf8");
  await symlink(outsideSecret, path.join(project, "README.md"));
  const resolvedProject = await realpath(project);
  const port = await freePort();
  const child = spawn(process.execPath, ["local-bridge.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      CODEX_OFFICE_PORT: String(port),
      CODEX_HOME: path.join(directory, "codex-home"),
      CODEX_OFFICE_CONFIG: path.join(directory, "workspace.json"),
      CODEX_OFFICE_HISTORY: history,
      CODEX_OFFICE_WORKSPACE: resolvedProject,
      CODEX_BIN: "/bin/echo",
      CODEX_OFFICE_CONFIRMATION: "off",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
    await rm(directory, { recursive: true, force: true });
  });

  const pairingCode = await waitFor(() => output.match(/pairing code: (\d{6})/i)?.[1]);
  const base = `http://127.0.0.1:${port}`;

  const bridgePage = await fetch(`${base}/`);
  assert.equal(bridgePage.status, 200);
  assert.doesNotMatch(await bridgePage.text(), new RegExp(resolvedProject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const rejectedOrigin = await fetch(`${base}/pair/status`, { headers: { Origin: "https://untrusted.example" } });
  assert.equal(rejectedOrigin.status, 403);

  const unpaired = await fetch(`${base}/snapshot`, { headers: { Origin: allowedOrigin } });
  assert.equal(unpaired.status, 401);

  const oversized = await fetch(`${base}/pair`, {
    method: "POST",
    headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: pairingCode, padding: "x".repeat(25_000) }),
  });
  assert.equal(oversized.status, 413);

  const pairResponse = await fetch(`${base}/pair`, {
    method: "POST",
    headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: pairingCode }),
  });
  assert.equal(pairResponse.status, 200);
  assert.equal(pairResponse.headers.get("access-control-allow-origin"), allowedOrigin);
  const paired = await pairResponse.json();
  assert.equal(typeof paired.token, "string");
  assert.ok(paired.token.length > 30);
  const headers = { Origin: allowedOrigin, Authorization: `Bearer ${paired.token}`, "Content-Type": "application/json" };

  const snapshotResponse = await fetch(`${base}/snapshot`, { headers });
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  assert.notEqual(snapshot.workspace, resolvedProject);
  assert.equal(snapshot.workspace.length, 24);
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(resolvedProject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(snapshot.bridge.codexPath, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /SYMLINK_ESCAPE_SECRET/);
  const heartbeatResponse = await fetch(`${base}/session/heartbeat`, { method: "POST", headers });
  assert.equal(heartbeatResponse.status, 204);

  const rejectedPath = await fetch(`${base}/workspace/activate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ path: resolvedProject }),
  });
  assert.equal(rejectedPath.status, 409);

  const attachmentResponse = await fetch(`${base}/attachments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspace: snapshot.workspace,
      attachments: [{ name: "brief.md", type: "text/markdown", data: Buffer.from("# Safe attachment").toString("base64") }],
    }),
  });
  assert.equal(attachmentResponse.status, 201);
  const attachment = await attachmentResponse.json();
  assert.equal(typeof attachment.uploadId, "string");
  assert.equal(attachment.uploadId.length, 32);
  assert.equal(attachment.files[0].name, "brief.md");
  assert.equal("path" in attachment.files[0], false);
  await assert.rejects(access(path.join(project, ".codex-attachments")));

  const taskResponse = await fetch(`${base}/task`, {
    method: "POST",
    headers,
    body: JSON.stringify({ workspace: snapshot.workspace, uploadId: attachment.uploadId, prompt: "Keep this task chat" }),
  });
  assert.equal(taskResponse.status, 202);

  const stored = await waitFor(async () => {
    try {
      const parsed = JSON.parse(await readFile(history, "utf8"));
      return parsed.tasks?.[0]?.chat?.some((message) => message.text.includes("Keep this task chat")) ? parsed : null;
    } catch { return null; }
  });
  assert.equal(stored.tasks[0].workspace, resolvedProject);
  assert.equal(stored.tasks[0].chat[0].from, "you");

  const unpairResponse = await fetch(`${base}/unpair`, { method: "POST", headers });
  assert.equal(unpairResponse.status, 200);
  const afterUnpair = await fetch(`${base}/snapshot`, { headers });
  assert.equal(afterUnpair.status, 401);
});
