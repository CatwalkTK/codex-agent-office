import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Codex Office at the main route", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Codex Office/);
  assert.match(html, /CODEX &amp; CO\./);
  assert.match(html, /REAL RUNTIME OFFICE/);
  assert.match(html, /WORKSPACE/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|NIGHT RAIDERS/i);
});

test("keeps the Tetris game on its own route", async () => {
  const response = await render("/tetris");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /NEON/);
  assert.match(html, /TETRIS/);
  assert.match(html, /START GAME/);
});

test("ships the office as the primary product", async () => {
  const [page, layout, office, game, workspacePicker, css, bridge] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OfficeDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TetrisGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/WorkspacePicker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../local-bridge.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<OfficeDashboard\s*\/>/);
  assert.match(layout, /Codex Office/);
  assert.match(office, /WorkspacePicker/);
  assert.match(office, /REAL DEV MONITOR/);
  assert.match(office, /DeskDocuments/);
  assert.match(office, /handoff-route/);
  assert.match(office, /Office本体は保護/);
  assert.match(office, /type="file"/);
  assert.match(office, /attachmentPaths/);
  assert.match(office, /project-queue/);
  assert.match(office, /runningTasks/);
  assert.match(office, /workspace:snapshot\.workspace/);
  assert.match(office, /projects:projects\|\|current\.projects/);
  assert.match(office, /selectedTaskId/);
  assert.match(office, /data-task-id/);
  assert.match(office, /CLICK TO SWITCH CHAT/);
  assert.match(workspacePicker, /複数の既存プロジェクトを一括追加/);
  assert.match(workspacePicker, /select\("multiple"\)/);
  assert.match(game, /HOLD/);
  assert.match(game, /NEXT/);
  assert.match(game, /hardDrop/);
  assert.match(game, /useState<Game>\(initialGame\)/);
  assert.match(game, /touch-controls/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /\.office-app/);
  assert.match(css, /\.desk-documents/);
  assert.match(css, /document-handoff/);
  assert.match(css, /Multi-project orchestration/);
  assert.match(css, /project-task-list/);
  assert.match(bridge, /isSeparateProject/);
  assert.match(bridge, /isolatedProjectOnly/);
  assert.match(bridge, /--sandbox", "workspace-write/);
  assert.match(bridge, /saveAttachments/);
  assert.match(bridge, /\/attachments/);
  assert.match(bridge, /runningChildren/);
  assert.match(bridge, /\/workspace\/activate/);
  assert.match(bridge, /task\.progress/);
  assert.match(bridge, /chooseFolders/);
  assert.match(bridge, /mode === "multiple"/);
  assert.match(bridge, /function taskChat/);
  assert.match(bridge, /taskChat\(task, "codex"/);
  assert.doesNotMatch(page + layout + office + game, /InvaderGame|codex-preview|_sites-preview/);
});
