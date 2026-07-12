import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.CODEX_OFFICE_PORT || 4312);
const WORKSPACE = path.resolve(process.env.CODEX_OFFICE_WORKSPACE || process.cwd());
const CODEX_HOME = process.env.CODEX_HOME || path.join(process.env.HOME || "", ".codex");
const CODEX_BIN = process.env.CODEX_BIN || "/Applications/ChatGPT.app/Contents/Resources/codex";
const clients = new Set();
let runningChild = null;
let sessionFile = null;
let sessionOffset = 0;
let sourcePath = "app/OfficeDashboard.tsx";

const state = {
  connected: true,
  workspace: WORKSPACE,
  session: null,
  taskState: "idle",
  turnId: null,
  currentTool: null,
  currentFile: null,
  lastAgentMessage: "",
  taskPrompt: "",
  startedAt: null,
  completedAt: null,
  tokenUsage: null,
  changedFiles: [],
  events: [],
  source: { path: sourcePath, lines: [] },
  agents: [{ id: "codex", name: "Codex", role: "coding agent", state: "idle", tool: null }],
};

function safeText(value, max = 180) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function addEvent(kind, label, detail = "", status = "info") {
  state.events = [...state.events.slice(-39), {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: new Date().toISOString(), kind, label: safeText(label), detail: safeText(detail), status,
  }];
}

function updateAgent(patch) {
  state.agents = [{ ...state.agents[0], ...patch }];
}

function toolSummary(name, rawInput) {
  let input = rawInput;
  try { if (typeof rawInput === "string") input = JSON.parse(rawInput); } catch {}
  const file = input?.path || input?.file_path || input?.workdir || input?.cwd;
  const command = input?.cmd || input?.command;
  const query = input?.query || input?.q || input?.prompt;
  return safeText(file || command || query || "");
}

function consumeRecord(record, origin = "session") {
  const payload = record?.payload || {};
  const type = payload.type || record?.type;

  if (type === "thread.started") {
    state.session = record.thread_id || "codex-exec"; broadcast(); return;
  }
  if (type === "turn.started") {
    state.taskState = "working"; state.startedAt ||= new Date().toISOString(); state.completedAt = null;
    updateAgent({ state: "working", tool: null }); addEvent("task", "タスク開始", state.taskPrompt, "running"); broadcast(); return;
  }
  if (type === "item.started") {
    const item = record.item || {}; const tool = item.type || "tool"; state.currentTool = tool;
    updateAgent({ state: "working", tool }); addEvent("tool", `${tool} 開始`, item.command || item.server || item.query || "", "running"); broadcast(); return;
  }
  if (type === "item.completed") {
    const item = record.item || {};
    if (item.type === "agent_message" && item.text) { state.lastAgentMessage = safeText(item.text, 1200); addEvent("message", "Codexメッセージ", state.lastAgentMessage); }
    else if (item.type === "command_execution") { state.currentTool = null; updateAgent({ state: "working", tool: null }); addEvent("tool", "コマンド完了", item.command || item.aggregated_output || "", item.status === "failed" ? "error" : "success"); }
    else if (item.type === "file_change") {
      const files = (item.changes || []).map((change) => change.path).filter(Boolean); state.changedFiles = [...new Set([...state.changedFiles, ...files])];
      if (files[0]) { state.currentFile = files[0]; void refreshSource(files[0]); } addEvent("file", "ファイル変更", files.join(", "), "success");
    } else { addEvent("tool", `${item.type || "item"} 完了`, item.server || item.query || "", "success"); }
    broadcast(); return;
  }
  if (type === "turn.completed") {
    state.taskState = "complete"; state.completedAt = new Date().toISOString(); state.currentTool = null; state.tokenUsage = record.usage || null;
    updateAgent({ state: "complete", tool: null }); addEvent("task", "タスク完了", state.lastAgentMessage, "success"); broadcast(); return;
  }
  if (type === "turn.failed" || type === "error") {
    state.taskState = "error"; state.completedAt = new Date().toISOString(); state.currentTool = null; updateAgent({ state: "error", tool: null });
    addEvent("task", "タスク失敗", record.error?.message || record.message || "", "error"); broadcast(); return;
  }

  if (type === "task_started") {
    state.taskState = "working"; state.turnId = payload.turn_id || null; state.startedAt = payload.started_at || new Date().toISOString(); state.completedAt = null;
    updateAgent({ state: "working", tool: null }); addEvent("task", "タスク開始", state.taskPrompt || "Codexが処理を開始", "running");
  } else if (type === "task_complete") {
    state.taskState = "complete"; state.completedAt = payload.completed_at || new Date().toISOString(); state.currentTool = null;
    if (payload.last_agent_message) state.lastAgentMessage = safeText(payload.last_agent_message, 1200);
    updateAgent({ state: "complete", tool: null }); addEvent("task", "タスク完了", state.lastAgentMessage, "success");
  } else if (type === "user_message") {
    const text = payload.message || payload.text || ""; state.taskPrompt = safeText(text, 500); addEvent("message", "ユーザー指示", state.taskPrompt);
  } else if (type === "custom_tool_call") {
    const name = payload.name || "tool"; const detail = toolSummary(name, payload.input); state.currentTool = name;
    updateAgent({ state: "working", tool: name }); addEvent("tool", `${name} 実行`, detail, "running");
  } else if (type === "mcp_tool_call_end") {
    state.currentTool = null; updateAgent({ state: state.taskState === "working" ? "working" : state.taskState, tool: null });
    addEvent("tool", `${payload.app_name || "MCP"} 完了`, `${payload.action_name || "tool"} · ${payload.duration || ""}`, "success");
  } else if (type === "patch_apply_end") {
    const changes = Array.isArray(payload.changes) ? payload.changes : [];
    const files = changes.map((change) => change.path || change.file).filter(Boolean);
    state.changedFiles = [...new Set([...state.changedFiles, ...files])].slice(-30);
    if (files[0]) { state.currentFile = files[0]; void refreshSource(files[0]); }
    addEvent("file", payload.success ? "ファイル更新" : "更新失敗", files.join(", "), payload.success ? "success" : "error");
  } else if (type === "agent_message") {
    if (payload.message) state.lastAgentMessage = safeText(payload.message, 1200);
    addEvent("message", "Codexメッセージ", state.lastAgentMessage);
  } else if (type === "token_count") {
    state.tokenUsage = payload.info || null;
  } else if (type === "web_search_end") {
    addEvent("web", "Web検索完了", payload.query || payload.action || "", "success");
  } else if (type === "image_generation_end") {
    addEvent("image", "画像生成完了", payload.saved_path || "", payload.status === "success" ? "success" : "info");
  }

  state.session = sessionFile ? path.basename(sessionFile) : origin;
  broadcast();
}

async function refreshSource(candidate = sourcePath) {
  const relative = candidate && !path.isAbsolute(candidate) ? candidate : sourcePath;
  const resolved = path.resolve(WORKSPACE, relative);
  if (!resolved.startsWith(`${WORKSPACE}${path.sep}`) && resolved !== WORKSPACE) return;
  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile() || stat.size > 300_000) return;
    const text = await fsp.readFile(resolved, "utf8");
    sourcePath = path.relative(WORKSPACE, resolved);
    state.source = { path: sourcePath, lines: text.split("\n").slice(0, 240) };
  } catch {}
}

async function findLatestSession() {
  const root = path.join(CODEX_HOME, "sessions");
  let newest = null;
  try {
    const entries = await fsp.readdir(root, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const full = path.join(entry.parentPath || entry.path, entry.name);
      const stat = await fsp.stat(full);
      if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { full, mtimeMs: stat.mtimeMs, size: stat.size };
    }
  } catch {}
  return newest;
}

async function pollSession() {
  if (runningChild) return;
  const latest = await findLatestSession();
  if (!latest) return;
  if (latest.full !== sessionFile) { sessionFile = latest.full; sessionOffset = latest.size; state.session = path.basename(sessionFile); broadcast(); return; }
  if (latest.size <= sessionOffset) return;
  const length = latest.size - sessionOffset;
  const handle = await fsp.open(sessionFile, "r");
  const buffer = Buffer.alloc(length);
  await handle.read(buffer, 0, length, sessionOffset); await handle.close(); sessionOffset = latest.size;
  for (const line of buffer.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try { consumeRecord(JSON.parse(line)); } catch {}
  }
}

function snapshot() { return JSON.stringify(state); }
function broadcast() {
  const data = `data: ${snapshot()}\n\n`;
  for (const client of clients) { try { client.write(data); } catch { clients.delete(client); } }
}

function runTask(prompt) {
  if (runningChild) throw new Error("Codex task is already running");
  state.taskPrompt = safeText(prompt, 1000); state.taskState = "starting"; state.changedFiles = []; state.lastAgentMessage = ""; state.startedAt = new Date().toISOString();
  updateAgent({ state: "starting", tool: null }); addEvent("task", "Codexを起動", state.taskPrompt, "running"); broadcast();
  const args = ["exec", "--json", "--color", "never", "--sandbox", "workspace-write", "--skip-git-repo-check", "-C", WORKSPACE, prompt];
  runningChild = spawn(CODEX_BIN, args, { cwd: WORKSPACE, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdoutBuffer = "";
  runningChild.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString(); const lines = stdoutBuffer.split("\n"); stdoutBuffer = lines.pop() || "";
    for (const line of lines) { try { consumeRecord(JSON.parse(line), "codex-exec"); } catch {} }
  });
  runningChild.stderr.on("data", (chunk) => { const text = chunk.toString(); addEvent("stderr", text.includes(" WARN ") ? "Codex警告" : "Codex stderr", text, text.includes(" WARN ") ? "warning" : "error"); broadcast(); });
  runningChild.on("close", (code) => {
    runningChild = null;
    if (code !== 0 && state.taskState !== "complete") { state.taskState = "error"; updateAgent({ state: "error", tool: null }); addEvent("task", "Codex終了", `exit ${code}`, "error"); }
    else if (state.taskState !== "complete") { state.taskState = "complete"; updateAgent({ state: "complete", tool: null }); addEvent("task", "プロセス完了", "exit 0", "success"); }
    state.currentTool = null; updateAgent({ state: state.taskState, tool: null });
    broadcast();
  });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname === "/events" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${snapshot()}\n\n`); clients.add(res); req.on("close", () => clients.delete(res)); return;
  }
  if (url.pathname === "/snapshot" && req.method === "GET") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(snapshot()); return; }
  if (url.pathname === "/task" && req.method === "POST") {
    let body = ""; req.on("data", (chunk) => { if (body.length < 20_000) body += chunk; });
    req.on("end", () => {
      try { const data = JSON.parse(body); if (!data.prompt?.trim()) throw new Error("prompt is required"); runTask(data.prompt.trim()); res.writeHead(202, { "Content-Type": "application/json" }); res.end(JSON.stringify({ accepted: true })); }
      catch (error) { res.writeHead(409, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
    }); return;
  }
  res.writeHead(404); res.end("Not found");
});

await refreshSource();
const latest = await findLatestSession(); if (latest) { sessionFile = latest.full; sessionOffset = latest.size; state.session = path.basename(sessionFile); }
server.listen(PORT, "127.0.0.1", () => console.log(`Codex Office bridge: http://127.0.0.1:${PORT} (${WORKSPACE})`));
setInterval(() => void pollSession(), 700);
