import http from "node:http";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.CODEX_OFFICE_PORT || 4312);
const CODEX_HOME = process.env.CODEX_HOME || path.join(process.env.HOME || "", ".codex");
const WORKSPACE_CONFIG = process.env.CODEX_OFFICE_CONFIG || path.join(CODEX_HOME, "office-workspace.json");
const HISTORY_FILE = process.env.CODEX_OFFICE_HISTORY || path.join(CODEX_HOME, "office", "history.json");
const SYSTEM_ROOT = await fsp.realpath(process.cwd()).catch(() => path.resolve(process.cwd()));
const ATTACHMENT_DIR = ".codex-attachments";
const MAX_ATTACHMENT_FILES = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL = 25 * 1024 * 1024;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const SESSION_IDLE_MS = 3 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS = 5;
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "https://codex-agent-office.dattsu.chatgpt.site"];
const allowedOrigins = new Set([...DEFAULT_ALLOWED_ORIGINS, ...(process.env.CODEX_OFFICE_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean)]);

async function isExecutable(candidate) {
  if (!candidate) return false;
  try { await fsp.access(candidate, process.platform === "win32" ? undefined : 1); return (await fsp.stat(candidate)).isFile(); } catch { return false; }
}

async function detectCodexBinary() {
  const candidates = [
    process.env.CODEX_BIN,
    process.platform === "darwin" ? "/Applications/ChatGPT.app/Contents/Resources/codex" : "",
    process.platform === "darwin" ? path.join(process.env.HOME || "", "Applications/ChatGPT.app/Contents/Resources/codex") : "",
    process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "Programs", "ChatGPT", "resources", "codex.exe") : "",
    "/opt/homebrew/bin/codex", "/usr/local/bin/codex", "/usr/bin/codex",
  ];
  const pathNames = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
  for (const directory of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) for (const name of pathNames) candidates.push(path.join(directory, name));
  for (const candidate of [...new Set(candidates.filter(Boolean))]) if (await isExecutable(candidate)) return candidate;
  return "";
}

function capture(command, args, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    if (!command) { resolve({ code: 127, output: "" }); return; }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", () => { clearTimeout(timer); resolve({ code: 127, output }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output }); });
  });
}

const CODEX_BIN = await detectCodexBinary();
const codexVersionResult = await capture(CODEX_BIN, ["--version"]);
const CODEX_VERSION = codexVersionResult.code === 0 ? safeVersion(codexVersionResult.output) : "";

function safeVersion(value) { return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120); }

function isSeparateProject(candidate) {
  if (!candidate) return false;
  const resolved = path.resolve(candidate);
  return resolved !== SYSTEM_ROOT && !resolved.startsWith(`${SYSTEM_ROOT}${path.sep}`) && !SYSTEM_ROOT.startsWith(`${resolved}${path.sep}`);
}

async function resolveSeparateProject(candidate) {
  if (!candidate) return "";
  const real = await fsp.realpath(candidate);
  const stat = await fsp.stat(real);
  if (!stat.isDirectory()) throw new Error("選択した作業フォルダーを読み込めません");
  if (!isSeparateProject(real)) throw new Error("Officeシステムとは別のプロジェクトフォルダーを選択してください");
  return real;
}

let savedConfig = {};
try { savedConfig = JSON.parse(await fsp.readFile(WORKSPACE_CONFIG, "utf8")); } catch {}
const configuredProjects = process.env.CODEX_OFFICE_WORKSPACE ? [process.env.CODEX_OFFICE_WORKSPACE] : [...(Array.isArray(savedConfig.projects) ? savedConfig.projects : []), savedConfig.workspace].filter(Boolean);
const initialProjects = [];
for (const candidate of configuredProjects) {
  try { const resolved = await resolveSeparateProject(candidate); if (!initialProjects.includes(resolved)) initialProjects.push(resolved); } catch {}
}
let initialWorkspace = "";
try { initialWorkspace = await resolveSeparateProject(savedConfig.activeWorkspace || process.env.CODEX_OFFICE_WORKSPACE || initialProjects[0]); } catch { initialWorkspace = initialProjects[0] || ""; }
let persistedTasks = [];
try {
  const history = JSON.parse(await fsp.readFile(HISTORY_FILE, "utf8"));
  if (Array.isArray(history.tasks)) persistedTasks = history.tasks.slice(-100).map((task) => {
    if (task?.state !== "working" && task?.state !== "starting") return task;
    const interruptedAt = new Date().toISOString();
    return { ...task, state: "error", progress: 100, currentTool: null, completedAt: interruptedAt, updatedAt: interruptedAt, chat: [...(task.chat || []), { id: `restart-${Date.now()}-${Math.random().toString(16).slice(2)}`, time: interruptedAt, from: "system", text: "Bridgeが停止したため、このタスクは中断されました。" }], events: [...(task.events || []), { id: `restart-event-${Date.now()}-${Math.random().toString(16).slice(2)}`, time: interruptedAt, kind: "task", label: "Bridge停止で中断", detail: "", status: "error" }] };
  });
} catch {}
const clients = new Map();
const runningChildren = new Map();
let pairingCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
let pairingExpiresAt = Date.now() + PAIRING_TTL_MS;
let pairingAttempts = 0;
const bridgeSessions = new Map();
let historyWriteTimer = null;
let sessionFile = null;
let sessionOffset = 0;
let workspace = initialWorkspace;
let projectPaths = [...initialProjects];
let sourcePath = "";

const state = {
  connected: true,
  workspace,
  sandbox: { enabled: true, mode: "workspace-write", isolatedProjectOnly: true, systemProtected: true },
  projects: projectPaths.map((projectPath) => ({ id: projectPath, name: path.basename(projectPath), path: projectPath, state: "idle", progress: 0, currentTool: null, taskPrompt: "", changedFiles: 0, startedAt: null, completedAt: null })),
  tasks: persistedTasks,
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
  bridge: { paired: false, codexFound: Boolean(CODEX_BIN && CODEX_VERSION), codexPath: CODEX_BIN || null, codexVersion: CODEX_VERSION || null, historyPersistent: true },
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
  if (!workspace) return;
  const resolved = candidate && path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(workspace, candidate || sourcePath);
  if (!resolved.startsWith(`${workspace}${path.sep}`) && resolved !== workspace) return;
  try {
    const stat = await fsp.stat(resolved);
    if (!stat.isFile() || stat.size > 300_000) return;
    const text = await fsp.readFile(resolved, "utf8");
    sourcePath = path.relative(workspace, resolved);
    state.source = { path: sourcePath, lines: text.split("\n").slice(0, 240) };
  } catch {}
}

async function findLatestSession() {
  if (!workspace) return null;
  const root = path.join(CODEX_HOME, "sessions");
  let newest = null;
  try {
    const entries = await fsp.readdir(root, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const full = path.join(entry.parentPath || entry.path, entry.name);
      const stat = await fsp.stat(full);
      if (newest && stat.mtimeMs <= newest.mtimeMs) continue;
      const handle = await fsp.open(full, "r");
      const buffer = Buffer.alloc(Math.min(stat.size, 64_000));
      await handle.read(buffer, 0, buffer.length, 0); await handle.close();
      const belongsToWorkspace = buffer.toString("utf8").split("\n").some((line) => {
        try {
          const record = JSON.parse(line); const cwd = record?.payload?.cwd || record?.cwd;
          return cwd && path.resolve(cwd) === workspace;
        } catch { return false; }
      });
      if (belongsToWorkspace) newest = { full, mtimeMs: stat.mtimeMs, size: stat.size };
    }
  } catch {}
  return newest;
}

async function pollSession() {
  if (runningChildren.size || state.tasks.length) return;
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
async function persistHistory() {
  const directory = path.dirname(HISTORY_FILE);
  const temporary = `${HISTORY_FILE}.${process.pid}.tmp`;
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  await fsp.writeFile(temporary, `${JSON.stringify({ version: 1, savedAt: new Date().toISOString(), tasks: state.tasks.slice(-100) }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fsp.rename(temporary, HISTORY_FILE);
  await fsp.chmod(HISTORY_FILE, 0o600).catch(() => {});
}

function scheduleHistoryPersist() {
  if (historyWriteTimer) clearTimeout(historyWriteTimer);
  historyWriteTimer = setTimeout(() => { historyWriteTimer = null; void persistHistory().catch((error) => console.error(`履歴を保存できません: ${error.message}`)); }, 80);
}
function broadcast() {
  const data = `data: ${snapshot()}\n\n`;
  for (const client of clients.keys()) { try { client.write(data); } catch { clients.delete(client); } }
}

function taskEvent(task, kind, label, detail = "", status = "info") {
  task.events = [...task.events.slice(-39), { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, time: new Date().toISOString(), kind, label: safeText(label), detail: safeText(detail), status }];
}

function taskChat(task, from, text) {
  if (typeof text !== "string" || !text.trim()) return;
  task.chat = [...(task.chat || []), { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, time: new Date().toISOString(), from, text: text.replace(/\r/g, "").trim().slice(0, 8_000) }].slice(-60);
}

function latestTaskFor(projectPath) {
  return [...state.tasks].reverse().find((task) => task.workspace === projectPath) || null;
}

function syncProjectSummaries() {
  state.projects = projectPaths.map((projectPath) => {
    const task = latestTaskFor(projectPath);
    return { id: projectPath, name: path.basename(projectPath), path: projectPath, state: task?.state || "idle", progress: task?.progress || 0, currentTool: task?.currentTool || null, taskPrompt: task?.prompt || "", changedFiles: task?.changedFiles.length || 0, startedAt: task?.startedAt || null, completedAt: task?.completedAt || null, taskId: task?.id || null };
  });
}

function syncActiveTaskView() {
  const task = latestTaskFor(workspace);
  if (!task) {
    state.session = null; state.taskState = workspace ? "idle" : "idle"; state.currentTool = null; state.currentFile = null; state.lastAgentMessage = ""; state.taskPrompt = ""; state.startedAt = null; state.completedAt = null; state.changedFiles = []; state.events = [];
    updateAgent({ state: workspace ? "idle" : "offline", tool: null });
  } else {
    state.session = task.threadId || task.id; state.taskState = task.state; state.currentTool = task.currentTool; state.currentFile = task.currentFile; state.lastAgentMessage = task.lastAgentMessage; state.taskPrompt = task.prompt; state.startedAt = task.startedAt; state.completedAt = task.completedAt; state.changedFiles = task.changedFiles; state.events = task.events;
    updateAgent({ state: task.state, tool: task.currentTool });
  }
  syncProjectSummaries();
}

function updateParallelTask(task) {
  task.updatedAt = new Date().toISOString();
  if (task.workspace === workspace) syncActiveTaskView(); else syncProjectSummaries();
  scheduleHistoryPersist();
  broadcast();
}

function consumeTaskRecord(record, task) {
  const type = record?.type;
  if (type === "thread.started") task.threadId = record.thread_id || task.threadId;
  else if (type === "turn.started") { task.state = "working"; task.progress = Math.max(task.progress, 10); taskEvent(task, "task", "タスク開始", task.prompt, "running"); }
  else if (type === "item.started") {
    const item = record.item || {}; task.currentTool = item.type || "tool"; task.progress = Math.min(85, Math.max(15, task.progress + 7));
    taskEvent(task, "tool", `${task.currentTool} 開始`, item.command || item.server || item.query || "", "running");
  } else if (type === "item.completed") {
    const item = record.item || {}; task.progress = Math.min(92, Math.max(20, task.progress + 8));
    if (item.type === "agent_message" && item.text) { task.lastAgentMessage = safeText(item.text, 1200); taskChat(task, "codex", item.text); taskEvent(task, "message", "Codexメッセージ", task.lastAgentMessage); }
    else if (item.type === "command_execution") { task.currentTool = null; taskEvent(task, "tool", "コマンド完了", item.command || item.aggregated_output || "", item.status === "failed" ? "error" : "success"); }
    else if (item.type === "file_change") {
      const files = (item.changes || []).map((change) => change.path).filter(Boolean); task.changedFiles = [...new Set([...task.changedFiles, ...files])].slice(-50); task.currentFile = files[0] || task.currentFile;
      if (files[0] && task.workspace === workspace) void refreshSource(files[0]); taskEvent(task, "file", "ファイル変更", files.join(", "), "success");
    } else taskEvent(task, "tool", `${item.type || "item"} 完了`, item.server || item.query || "", "success");
  } else if (type === "turn.completed") {
    task.state = "complete"; task.progress = 100; task.completedAt = new Date().toISOString(); task.currentTool = null; task.tokenUsage = record.usage || null; taskEvent(task, "task", "タスク完了", task.lastAgentMessage, "success");
  } else if (type === "turn.failed" || type === "error") {
    const errorMessage = record.error?.message || record.message || "タスクを完了できませんでした";
    task.state = "error"; task.progress = 100; task.completedAt = new Date().toISOString(); task.currentTool = null; taskChat(task, "system", errorMessage); taskEvent(task, "task", "タスク失敗", errorMessage, "error");
  }
  updateParallelTask(task);
}

function runTask(prompt, attachmentPaths = [], targetWorkspace = workspace) {
  if (!targetWorkspace) throw new Error("先にOfficeシステムとは別のプロジェクトフォルダーを選択してください");
  if (!CODEX_BIN || !CODEX_VERSION) throw new Error("Codexを検出できません。ChatGPTアプリまたはCodex CLIをインストールしてください");
  if (!isSeparateProject(targetWorkspace)) throw new Error("保護対象のOfficeシステムではタスクを実行できません");
  if ([...runningChildren.values()].some((entry) => entry.task.workspace === targetWorkspace)) throw new Error("このプロジェクトでは別のタスクが実行中です。別プロジェクトは同時実行できます");
  const projectName = path.basename(targetWorkspace);
  const submittedText = `${safeText(prompt, 1000)}${attachmentPaths.length ? `\n📎 ${attachmentPaths.map((file) => path.basename(file)).join(", ")}` : ""}`;
  const task = { id: `task-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, projectId: targetWorkspace, projectName, workspace: targetWorkspace, prompt: safeText(prompt, 1000), attachmentPaths, state: "starting", progress: 5, currentTool: null, currentFile: null, lastAgentMessage: "", startedAt: new Date().toISOString(), completedAt: null, updatedAt: new Date().toISOString(), changedFiles: [], events: [], chat: [], threadId: null, tokenUsage: null };
  taskChat(task, "you", submittedText);
  taskChat(task, "system", `${projectName}でタスクを受け付けました。別タスクへ切り替えても処理は継続します。`);
  taskEvent(task, "task", "Codexを起動", task.prompt, "running");
  if (attachmentPaths.length) taskEvent(task, "attachment", "添付ファイル受領", `${attachmentPaths.length} files`, "success");
  const runningHistory = state.tasks.filter((item) => item.state === "working" || item.state === "starting");
  const completedHistory = state.tasks.filter((item) => item.state !== "working" && item.state !== "starting").slice(-24);
  state.tasks = [...completedHistory, ...runningHistory, task]; syncProjectSummaries(); if (task.workspace === workspace) syncActiveTaskView(); scheduleHistoryPersist(); broadcast();
  const attachmentNote = attachmentPaths.length ? `\n\n次の添付ファイルが外部プロジェクト内に保存されています。内容を確認してタスクに利用してください。\n${attachmentPaths.map((file) => `- ${file}`).join("\n")}` : "";
  const args = ["exec", "--json", "--color", "never", "--sandbox", "workspace-write", "--skip-git-repo-check", "-C", targetWorkspace, `${prompt}${attachmentNote}`];
  const child = spawn(CODEX_BIN, args, { cwd: targetWorkspace, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  runningChildren.set(task.id, { child, task });
  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString(); const lines = stdoutBuffer.split("\n"); stdoutBuffer = lines.pop() || "";
    for (const line of lines) { try { consumeTaskRecord(JSON.parse(line), task); } catch {} }
  });
  child.stderr.on("data", (chunk) => { const text = chunk.toString(); taskEvent(task, "stderr", text.includes(" WARN ") ? "Codex警告" : "Codex stderr", text, text.includes(" WARN ") ? "warning" : "error"); updateParallelTask(task); });
  child.on("error", (error) => { task.state = "error"; task.progress = 100; task.completedAt = new Date().toISOString(); taskChat(task, "system", error.message); taskEvent(task, "task", "Codex起動失敗", error.message, "error"); runningChildren.delete(task.id); updateParallelTask(task); });
  child.on("close", (code) => {
    runningChildren.delete(task.id);
    if (task.state !== "complete" && task.state !== "error") { task.state = code === 0 ? "complete" : "error"; task.progress = 100; task.completedAt = new Date().toISOString(); task.currentTool = null; if (code !== 0) taskChat(task, "system", `Codexが終了しました（exit ${code}）`); taskEvent(task, "task", code === 0 ? "プロセス完了" : "Codex終了", `exit ${code}`, code === 0 ? "success" : "error"); }
    updateParallelTask(task);
  });
  return task;
}

function readBody(req, limit = 20_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) reject(new Error("request is too large"));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function safeAttachmentName(value, index) {
  const base = path.basename(String(value || `file-${index + 1}`));
  const cleaned = base.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || `file-${index + 1}`;
}

async function registeredWorkspace(candidate = workspace) {
  const resolved = await resolveSeparateProject(candidate);
  if (!projectPaths.includes(resolved)) throw new Error("登録されていない外部プロジェクトです");
  return resolved;
}

async function saveAttachments(items, targetWorkspace = workspace) {
  targetWorkspace = await registeredWorkspace(targetWorkspace);
  if (!Array.isArray(items) || !items.length) throw new Error("添付ファイルがありません");
  if (items.length > MAX_ATTACHMENT_FILES) throw new Error(`添付できるファイルは最大${MAX_ATTACHMENT_FILES}件です`);
  const decoded = items.map((item, index) => {
    const buffer = Buffer.from(String(item?.data || ""), "base64");
    if (!buffer.length) throw new Error(`${safeAttachmentName(item?.name, index)} を読み込めません`);
    if (buffer.length > MAX_ATTACHMENT_BYTES) throw new Error("1ファイルの上限は10MBです");
    return { buffer, name: safeAttachmentName(item?.name, index), type: safeText(item?.type || "application/octet-stream", 100) };
  });
  if (decoded.reduce((sum, item) => sum + item.buffer.length, 0) > MAX_ATTACHMENT_TOTAL) throw new Error("添付ファイルの合計上限は25MBです");
  const directory = path.join(targetWorkspace, ATTACHMENT_DIR);
  await fsp.mkdir(directory, { recursive: true });
  const batch = new Date().toISOString().replace(/[:.]/g, "-");
  const saved = [];
  for (const [index, item] of decoded.entries()) {
    const filename = `${batch}-${index + 1}-${item.name}`;
    const absolute = path.join(directory, filename);
    await fsp.writeFile(absolute, item.buffer, { flag: "wx" });
    saved.push({ name: item.name, path: path.relative(targetWorkspace, absolute), size: item.buffer.length, type: item.type });
  }
  addEvent("attachment", "ファイルを受領", saved.map((item) => item.name).join(", "), "success");
  broadcast();
  return saved;
}

async function validateAttachmentPaths(values, targetWorkspace = workspace) {
  if (!Array.isArray(values)) return [];
  targetWorkspace = await registeredWorkspace(targetWorkspace);
  const valid = [];
  for (const value of values.slice(0, MAX_ATTACHMENT_FILES)) {
    const relative = String(value || "");
    if (!relative.startsWith(`${ATTACHMENT_DIR}${path.sep}`) && !relative.startsWith(`${ATTACHMENT_DIR}/`)) throw new Error("無効な添付ファイルパスです");
    const absolute = await fsp.realpath(path.resolve(targetWorkspace, relative));
    if (!absolute.startsWith(`${targetWorkspace}${path.sep}${ATTACHMENT_DIR}${path.sep}`)) throw new Error("添付ファイルがサンドボックス外です");
    if (!(await fsp.stat(absolute)).isFile()) throw new Error("添付ファイルを読み込めません");
    valid.push(path.relative(targetWorkspace, absolute));
  }
  return valid;
}

function chooseFolder(prompt) {
  return new Promise((resolve, reject) => {
    const script = `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`;
    const child = spawn("/usr/bin/osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.on("close", (code) => {
      if (code === 0 && output.trim()) resolve(output.trim());
      else if (/User canceled/i.test(errorOutput)) reject(new Error("フォルダー選択をキャンセルしました"));
      else reject(new Error(safeText(errorOutput) || "フォルダーを選択できませんでした"));
    });
  });
}

function chooseFolders(prompt) {
  return new Promise((resolve, reject) => {
    const script = `set chosenFolders to choose folder with prompt ${JSON.stringify(prompt)} with multiple selections allowed\nset output to ""\nrepeat with selectedFolder in chosenFolders\nset output to output & POSIX path of selectedFolder & linefeed\nend repeat\nreturn output`;
    const child = spawn("/usr/bin/osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let errorOutput = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
    child.on("close", (code) => {
      const folders = output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      if (code === 0 && folders.length) resolve(folders);
      else if (/User canceled/i.test(errorOutput)) reject(new Error("フォルダー選択をキャンセルしました"));
      else reject(new Error(safeText(errorOutput) || "プロジェクトフォルダーを選択できませんでした"));
    });
  });
}

async function defaultSourceFor(root) {
  for (const candidate of ["README.md", "package.json", "app/page.tsx", "src/index.ts", "src/index.js"]) {
    try { if ((await fsp.stat(path.join(root, candidate))).isFile()) return candidate; } catch {}
  }
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const file = entries.find((entry) => entry.isFile() && /\.(?:md|txt|json|[cm]?[jt]sx?|css|html)$/i.test(entry.name));
    if (file) return file.name;
  } catch {}
  return "";
}

async function switchWorkspace(nextWorkspace) {
  workspace = await resolveSeparateProject(nextWorkspace);
  if (!projectPaths.includes(workspace)) projectPaths.push(workspace);
  await fsp.mkdir(CODEX_HOME, { recursive: true });
  await fsp.writeFile(WORKSPACE_CONFIG, `${JSON.stringify({ projects: projectPaths, activeWorkspace: workspace }, null, 2)}\n`, "utf8");
  state.workspace = workspace;
  sessionFile = null;
  sessionOffset = 0;
  sourcePath = await defaultSourceFor(workspace);
  state.source = { path: sourcePath, lines: [] };
  if (sourcePath) await refreshSource(sourcePath);
  syncActiveTaskView();
  const activeTask = latestTaskFor(workspace);
  if (activeTask?.currentFile) await refreshSource(activeTask.currentFile);
  broadcast();
  return workspace;
}

async function selectWorkspace(data) {
  const mode = data?.mode;
  if (mode !== "existing" && mode !== "multiple" && mode !== "new") throw new Error("mode must be existing, multiple or new");
  if (mode === "multiple") {
    const selectedFolders = Array.isArray(data.paths) ? data.paths : await chooseFolders("追加するプロジェクトを複数選択");
    if (!selectedFolders.length) throw new Error("追加するプロジェクトを選択してください");
    let selected = workspace;
    for (const selectedFolder of selectedFolders) selected = await switchWorkspace(selectedFolder);
    return selected;
  }
  if (mode === "existing") {
    const selected = data.path || await chooseFolder("既存の作業フォルダーを選択");
    return switchWorkspace(selected);
  }
  const name = String(data.name || "").trim();
  if (!name || name === "." || name === ".." || /[\/:\0]/.test(name)) throw new Error("有効なフォルダー名を入力してください");
  const parent = data.path || await chooseFolder("新しい作業フォルダーの作成場所を選択");
  const realParent = await fsp.realpath(parent);
  const created = path.join(realParent, name);
  if (!isSeparateProject(created)) throw new Error("Officeシステムの中には作業フォルダーを作成できません");
  try { await fsp.mkdir(created, { recursive: false }); }
  catch (error) {
    if (error?.code === "EEXIST") throw new Error("同じ名前のフォルダーがすでにあります");
    throw error;
  }
  return switchWorkspace(created);
}

function rotatePairingCode() {
  pairingCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  pairingExpiresAt = Date.now() + PAIRING_TTL_MS;
  pairingAttempts = 0;
  console.log(`Codex Office pairing code: ${pairingCode} (10分以内に入力)`);
}

function ensurePairingCode() {
  if (!pairingCode && bridgeSessions.size) return;
  if (!pairingCode || Date.now() >= pairingExpiresAt) rotatePairingCode();
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || "")); const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requestToken(req) {
  const authorization = String(req.headers.authorization || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function matchingSessionToken(token) { return token ? [...bridgeSessions.keys()].find((candidate) => safeEqual(candidate, token)) || "" : ""; }
function isAuthorized(req) { return Boolean(matchingSessionToken(requestToken(req))); }

function applyCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (origin && !allowedOrigins.has(origin)) return false;
  if (origin) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  return true;
}

async function confirmTaskExecution(prompt, targetWorkspace, attachmentCount) {
  if (process.env.CODEX_OFFICE_CONFIRMATION === "off") return true;
  if (process.platform !== "darwin") throw new Error("このOSのローカル実行確認にはまだ対応していません");
  const script = `on run argv\nset projectName to item 1 of argv\nset taskPrompt to item 2 of argv\nset attachmentInfo to item 3 of argv\ntry\nset answer to display dialog "プロジェクト: " & projectName & return & "依頼: " & taskPrompt & return & attachmentInfo buttons {"拒否", "実行を許可"} default button "実行を許可" cancel button "拒否" with title "Codex Office 実行確認" with icon caution giving up after 300\nreturn button returned of answer\non error\nreturn "拒否"\nend try\nend run`;
  const result = await capture("/usr/bin/osascript", ["-e", script, path.basename(targetWorkspace), safeText(prompt, 500), attachmentCount ? `添付: ${attachmentCount}件` : "添付: なし"], 305_000);
  return result.code === 0 && /実行を許可/.test(result.output);
}

async function codexLoginSummary() {
  if (!CODEX_BIN || !CODEX_VERSION) return { found: false, path: null, version: null, authenticated: false, method: null };
  const result = await capture(CODEX_BIN, ["login", "status"]);
  const text = safeText(result.output, 300);
  const method = /ChatGPT/i.test(text) ? "chatgpt" : /API/i.test(text) ? "api" : null;
  return { found: true, path: CODEX_BIN, version: CODEX_VERSION, authenticated: result.code === 0, method };
}

const server = http.createServer(async (req, res) => {
  if (!applyCors(req, res)) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "このサイトからのBridge接続は許可されていません" })); return; }
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname === "/" && req.method === "GET") {
    ensurePairingCode();
    const pairDisplay = bridgeSessions.size ? "接続済み（接続解除またはBridge再起動で新しいコードを発行）" : pairingCode;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Codex Office Bridge</title><style>html{color-scheme:dark;font:15px system-ui;background:#0d121b;color:#dbe6ef}body{max-width:720px;margin:10vh auto;padding:24px}.card{border:1px solid #39485a;background:#151d29;padding:28px;box-shadow:0 12px 45px #0008}.live{color:#67dfa8}code{display:block;margin-top:12px;padding:12px;background:#090d13;overflow-wrap:anywhere}.pair{font:700 28px ui-monospace;color:#f1ca6c;letter-spacing:.18em}</style><body><main class="card"><h1><span class="live">●</span> Codex Office Bridge</h1><p>Bridge はローカルPC上で安全に待機しています。</p><p>ペアリングコード</p><code class="pair">${pairDisplay}</code><p>Codex: ${CODEX_VERSION || "未検出"}</p><code>${(state.workspace || "外部プロジェクト未選択").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character])}</code><p>履歴: ${HISTORY_FILE.replace(/[&<>"']/g, "")}</p></main></body></html>`);
    return;
  }
  if (url.pathname === "/pair/status" && req.method === "GET") {
    ensurePairingCode();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ pairingRequired: true, paired: bridgeSessions.size > 0, codeAvailable: Boolean(pairingCode), expiresAt: pairingCode ? new Date(pairingExpiresAt).toISOString() : null, codexFound: Boolean(CODEX_BIN && CODEX_VERSION), codexVersion: CODEX_VERSION || null }));
    return;
  }
  if (url.pathname === "/pair" && req.method === "POST") {
    try {
      ensurePairingCode();
      if (!pairingCode) throw new Error("Bridgeはすでに別のタブと接続済みです");
      if (pairingAttempts >= MAX_PAIRING_ATTEMPTS) { res.writeHead(429, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "入力回数の上限に達しました。Bridgeを再起動してください" })); return; }
      const data = await readBody(req); const supplied = String(data.code || "").replace(/\D/g, "");
      if (!safeEqual(supplied, pairingCode)) { pairingAttempts += 1; res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "ペアリングコードが正しくありません", remaining: Math.max(0, MAX_PAIRING_ATTEMPTS - pairingAttempts) })); return; }
      const token = crypto.randomBytes(32).toString("base64url"); bridgeSessions.set(token, Date.now()); pairingCode = ""; pairingExpiresAt = 0; state.bridge.paired = true;
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ paired: true, token, codex: await codexLoginSummary() }));
    } catch (error) { res.writeHead(409, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error.message || "ペアリングできませんでした" })); }
    return;
  }
  if (!isAuthorized(req)) { res.writeHead(401, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: "Bridgeとのペアリングが必要です", code: "PAIRING_REQUIRED" })); return; }
  const authenticatedToken = matchingSessionToken(requestToken(req)); bridgeSessions.set(authenticatedToken, Date.now());
  if (url.pathname === "/session/heartbeat" && req.method === "POST") { res.writeHead(204); res.end(); return; }
  if (url.pathname === "/unpair" && req.method === "POST") {
    bridgeSessions.delete(authenticatedToken); state.bridge.paired = bridgeSessions.size > 0;
    for (const [client, clientToken] of clients) if (safeEqual(clientToken, authenticatedToken)) { client.end(); clients.delete(client); }
    if (!bridgeSessions.size) rotatePairingCode();
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ paired: false })); return;
  }
  if (url.pathname === "/codex/status" && req.method === "GET") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(await codexLoginSummary())); return; }
  if (url.pathname === "/history" && req.method === "DELETE") {
    state.tasks = []; syncActiveTaskView(); await persistHistory(); broadcast();
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ cleared: true })); return;
  }
  if (url.pathname === "/events" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${snapshot()}\n\n`); clients.set(res, requestToken(req)); req.on("close", () => clients.delete(res)); return;
  }
  if (url.pathname === "/snapshot" && req.method === "GET") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(snapshot()); return; }
  if (url.pathname === "/attachments" && req.method === "POST") {
    try {
      const data = await readBody(req, 40_000_000);
      const files = await saveAttachments(data.attachments, data.workspace || workspace);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files }));
    } catch (error) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error?.message || "ファイルを添付できませんでした" }));
    }
    return;
  }
  if (url.pathname === "/workspace" && req.method === "POST") {
    try {
      const data = await readBody(req);
      const selected = await selectWorkspace(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ workspace: selected, snapshot: state }));
    } catch (error) {
      const cancelled = /キャンセル/.test(error?.message || "");
      res.writeHead(cancelled ? 400 : 409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error?.message || "作業フォルダーを変更できませんでした" }));
    }
    return;
  }
  if (url.pathname === "/workspace/activate" && req.method === "POST") {
    try {
      const data = await readBody(req); const selected = await registeredWorkspace(data.path);
      await switchWorkspace(selected);
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ workspace: selected, snapshot: state }));
    } catch (error) {
      res.writeHead(409, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error?.message || "プロジェクトを切り替えられませんでした" }));
    }
    return;
  }
  if (url.pathname === "/task" && req.method === "POST") {
    try {
      const data = await readBody(req); const targetWorkspace = await registeredWorkspace(data.workspace || workspace); const attachmentPaths = await validateAttachmentPaths(data.attachmentPaths, targetWorkspace);
      const prompt = data.prompt?.trim() || (attachmentPaths.length ? "添付ファイルを確認してください。" : "");
      if (!prompt) throw new Error("prompt is required");
      const approved = await confirmTaskExecution(prompt, targetWorkspace, attachmentPaths.length);
      if (!approved) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "ローカル確認でタスクが拒否されました" })); return; }
      const task = runTask(prompt, attachmentPaths, targetWorkspace); res.writeHead(202, { "Content-Type": "application/json" }); res.end(JSON.stringify({ accepted: true, taskId: task.id, project: targetWorkspace, attachments: attachmentPaths }));
    } catch (error) { res.writeHead(409, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
    return;
  }
  res.writeHead(404); res.end("Not found");
});

if (workspace) { sourcePath = await defaultSourceFor(workspace); state.source.path = sourcePath; }
await refreshSource();
syncActiveTaskView();
const latest = await findLatestSession(); if (latest) { sessionFile = latest.full; sessionOffset = latest.size; state.session = path.basename(sessionFile); }
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Codex Office bridge: http://127.0.0.1:${PORT} (${workspace || "external project not selected"})`);
  console.log(`Codex: ${CODEX_VERSION || "未検出"}${CODEX_BIN ? ` · ${CODEX_BIN}` : ""}`);
  console.log(`Codex Office pairing code: ${pairingCode} (10分以内に入力)`);
  console.log(`チャット履歴: ${HISTORY_FILE}`);
});
setInterval(() => void pollSession(), 700);
setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS; const expired = [];
  for (const [token, lastSeen] of bridgeSessions) if (lastSeen < cutoff) { bridgeSessions.delete(token); expired.push(token); }
  if (!expired.length) return;
  for (const [client, clientToken] of clients) if (expired.some((token) => safeEqual(token, clientToken))) { client.end(); clients.delete(client); }
  state.bridge.paired = bridgeSessions.size > 0;
  if (!bridgeSessions.size) rotatePairingCode();
}, 30_000).unref();

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  if (historyWriteTimer) clearTimeout(historyWriteTimer);
  await persistHistory().catch(() => {});
  for (const { child } of runningChildren.values()) child.kill("SIGTERM");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
