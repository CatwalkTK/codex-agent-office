"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMarkdown } from "./ChatMarkdown";
import { WorkspacePicker } from "./WorkspacePicker";

type Facing = "up" | "down" | "left" | "right";
type Point = { x: number; y: number; facing: Facing };
type RuntimeEvent = { id: string; time: string; kind: string; label: string; detail: string; status: string };
type AgentState = { id: string; name: string; role: string; state: string; tool: string | null; taskId?: string | null; projectName?: string | null };
type ProjectSummary = { id: string; name: string; path: string; state: string; progress: number; currentTool: string | null; taskPrompt: string; changedFiles: number; startedAt: string | null; completedAt: string | null; taskId?: string | null };
type ChatMessage = { id?: string; time?: string; from: "you" | "codex" | "system"; text: string };
type ParallelTask = { id: string; projectId: string; projectName: string; workspace: string; prompt: string; attachmentPaths?: string[]; state: string; progress: number; currentTool: string | null; currentFile: string | null; lastAgentMessage: string; startedAt: string; completedAt: string | null; updatedAt: string; changedFiles: string[]; events: RuntimeEvent[]; chat?: ChatMessage[]; agentId?: string | null; agentName?: string | null; isolated?: boolean; branch?: string | null; integrationPending?: boolean };
type Snapshot = {
  connected: boolean; workspace: string; session: string | null; taskState: string; currentTool: string | null; currentFile: string | null;
  lastAgentMessage: string; taskPrompt: string; startedAt: string | null; completedAt: string | null; changedFiles: string[];
  events: RuntimeEvent[]; source: { path: string; lines: string[] }; agents: AgentState[];
  sandbox?: { enabled: boolean; mode: string; isolatedProjectOnly: boolean; systemProtected: boolean };
  projects: ProjectSummary[]; tasks: ParallelTask[];
  pool?: { maxAgents: number; activeAgents: number; queuedTasks: number; worktreesEnabled: boolean };
  bridge?: { paired: boolean; codexFound: boolean; codexPath: string | null; codexVersion: string | null; historyPersistent: boolean };
};

const BRIDGE = "http://127.0.0.1:4312";
const emptySnapshot: Snapshot = { connected: false, workspace: "", session: null, taskState: "disconnected", currentTool: null, currentFile: null, lastAgentMessage: "", taskPrompt: "", startedAt: null, completedAt: null, changedFiles: [], events: [], source: { path: "", lines: [] }, agents: [], projects: [], tasks: [], pool:{maxAgents:10,activeAgents:0,queuedTasks:0,worktreesEnabled:true} };
const departmentDeskPositions = [
  { x:13,y:19,room:"社長室" },{ x:37,y:19,room:"企画室" },{ x:63,y:19,room:"開発室" },{ x:87,y:19,room:"品質室" },
  { x:13,y:45,room:"調査室" },{ x:87,y:45,room:"運用室" },
  { x:13,y:68,room:"設計室" },{ x:34,y:68,room:"制作室" },{ x:66,y:68,room:"監査室" },{ x:87,y:68,room:"支援室" },
];
const agentPositions = departmentDeskPositions.map((desk)=>({x:desk.x,y:desk.y-3}));
const officeRoster = [
  { id:"codex", name:"Codex", role:"統括・オーケストレーター" }, { id:"scout", name:"Scout", role:"検索・調査" }, { id:"mika", name:"Mika", role:"編集・実装" }, { id:"reviewer", name:"Reviewer", role:"コードレビュー" }, { id:"sora", name:"Sora", role:"テスト・品質保証" },
  { id:"architect", name:"Architect", role:"設計・分解" }, { id:"analyst", name:"Analyst", role:"分析・要件整理" }, { id:"builder", name:"Builder", role:"並列実装" }, { id:"auditor", name:"Auditor", role:"監査・検証" }, { id:"ops", name:"Ops", role:"実行・運用" },
  { id:"researcher", name:"Researcher", role:"深掘り調査" }, { id:"designer", name:"Designer", role:"UI・体験設計" }, { id:"writer", name:"Writer", role:"文書・仕様" }, { id:"tester2", name:"Tester II", role:"並列テスト" }, { id:"reviewer2", name:"Reviewer II", role:"追加レビュー" }, { id:"security", name:"Security", role:"セキュリティ" }, { id:"data", name:"Data", role:"データ処理" }, { id:"release", name:"Release", role:"リリース管理" }, { id:"support", name:"Support", role:"調整・支援" }, { id:"runner", name:"Runner", role:"補助実行" },
];
const obstacles = [
  ...departmentDeskPositions.map((desk)=>({x1:desk.x-9,x2:desk.x+9,y1:desk.y-6,y2:desk.y+8})),
  {x1:35,x2:65,y1:37,y2:59},
];
function blocked(x: number, y: number) { return obstacles.some((o) => x > o.x1 && x < o.x2 && y > o.y1 && y < o.y2); }

function RuntimeCharacter({ agent, index }: { agent: AgentState; index: number }) {
  const position = agentPositions[index] || { x: 50 + (index % 3) * 12, y: 45 + Math.floor(index / 3) * 20 };
  const spriteIndex = (index % 5) + 1;
  const style = { left:`${position.x}%`, top:`${position.y}%`, "--agent-scale":".78", "--walk-x":`${index%2 ? 15 : -15}px`, "--walk-y":`${index%3 ? 8 : -7}px`, "--walk-delay":`${-(index*1.17)}s`, "--walk-duration":`${7+(index%5)*1.2}s` } as React.CSSProperties;
  const walking = agent.state === "idle" && index >= 5;
  return <div className={`npc image-npc runtime-npc pool-agent state-${agent.state} ${walking?"ambient-walk":""}`} style={style}>
    {index === 0 && <div className="manager-badge">CODEX</div>}
    <div className="npc-art" style={{ backgroundPosition: `${spriteIndex * 20}% 50%` }} />
    <div className="npc-tag"><b>{agent.name}</b><span>{agent.projectName || agent.tool || (walking?"巡回中":agent.state)}</span></div>
    {agent.state === "working" && <div className="work-spark">•••</div>}
  </div>;
}

function formatTime(value: string) {
  try { return new Date(value).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); } catch { return "--:--:--"; }
}

function DeskDocuments({ level, label, tone, active = false }: { level: number; label: string; tone: string; active?: boolean }) {
  return <div className={`desk-documents tone-${tone} ${active ? "active" : ""}`} aria-label={`${label}の資料 ${level}束`}>
    <small>{label}</small>
    <div className="paper-tray">{Array.from({ length: level }, (_, index) => <span key={index} style={{ bottom: `${4 + index * 4}px`, left: `${3 + (index % 2) * 2}px`, transform: `rotate(${index % 2 ? 2 : -2}deg)` }} />)}</div>
    {active && <b className="document-alert">!</b>}
  </div>;
}

export function OfficeDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [player, setPlayer] = useState<Point>({ x: 50, y: 90, facing: "up" });
  const [entering, setEntering] = useState(true);
  const [doorOpen, setDoorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bridgeToken, setBridgeToken] = useState("");
  const [pairingRequired, setPairingRequired] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingMessage, setPairingMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const bridgeTokenRef = useRef("");
  const bridgeChannelRef = useRef<BroadcastChannel | null>(null);
  const bridgeRequestRef = useRef("");
  const nearCodex = Math.hypot(player.x - 13, player.y - 32) < 10;

  const clearPairing = useCallback(() => {
    const revokedToken = bridgeTokenRef.current;
    window.sessionStorage.removeItem("codex-office-bridge-token"); bridgeTokenRef.current = ""; setBridgeToken(""); setBridgeConnected(false); setPairingRequired(true);
    if (revokedToken) bridgeChannelRef.current?.postMessage({ type:"session-revoked", token:revokedToken });
  }, []);

  const bridgeFetch = useCallback((pathname: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); if (bridgeToken) headers.set("Authorization", `Bearer ${bridgeToken}`);
    return fetch(`${BRIDGE}${pathname}`, { ...init, headers }).then((response) => { if (response.status === 401) clearPairing(); return response; });
  }, [bridgeToken, clearPairing]);

  useEffect(() => {
    const saved = window.sessionStorage.getItem("codex-office-bridge-token") || "";
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("codex-office-bridge-session-v1");
    bridgeChannelRef.current = channel;
    const requestId = window.crypto.randomUUID(); bridgeRequestRef.current = requestId;
    const accept = (token: string) => {
      if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return;
      bridgeTokenRef.current = token; window.sessionStorage.setItem("codex-office-bridge-token", token); setBridgeToken(token); setPairingRequired(false); setPairingMessage("既存のOfficeタブからBridge接続を引き継ぎました。");
    };
    if (channel) {
      channel.onmessage = (event) => {
        const data = event.data || {};
        if (data.type === "session-request" && bridgeTokenRef.current) channel.postMessage({ type:"session-share", requestId:data.requestId, token:bridgeTokenRef.current });
        else if (data.type === "session-share" && data.requestId === bridgeRequestRef.current && !bridgeTokenRef.current) accept(String(data.token || ""));
        else if (data.type === "session-revoked" && data.token === bridgeTokenRef.current) { window.sessionStorage.removeItem("codex-office-bridge-token"); bridgeTokenRef.current=""; setBridgeToken(""); setBridgeConnected(false); setPairingRequired(true); }
      };
    }
    if (saved) { bridgeTokenRef.current = saved; setBridgeToken(saved); }
    else { setPairingRequired(true); channel?.postMessage({ type:"session-request", requestId }); }
    return () => { channel?.close(); if (bridgeChannelRef.current === channel) bridgeChannelRef.current = null; };
  }, []);

  useEffect(() => {
    if (!bridgeToken) return;
    const controller = new AbortController(); let active = true;
    void (async () => {
      try {
        const response = await fetch(`${BRIDGE}/events`, { headers:{ Authorization:`Bearer ${bridgeToken}` }, signal:controller.signal });
        if (response.status === 401) { if (active) clearPairing(); return; }
        if (!response.ok || !response.body) throw new Error("Bridge stream unavailable");
        setPairingRequired(false); setBridgeConnected(true);
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (active) {
          const { value, done } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream:true }); const blocks = buffer.split("\n\n"); buffer = blocks.pop() || "";
          for (const block of blocks) {
            const data = block.split("\n").filter((line)=>line.startsWith("data: ")).map((line)=>line.slice(6)).join("\n");
            if (data) { try { setSnapshot(JSON.parse(data)); setBridgeConnected(true); } catch {} }
          }
        }
      } catch (error) { if (active && !(error instanceof DOMException && error.name === "AbortError")) setBridgeConnected(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [bridgeToken, clearPairing]);

  useEffect(() => {
    if (!bridgeToken) return;
    const heartbeat = window.setInterval(() => { void bridgeFetch("/session/heartbeat", { method:"POST" }).catch(() => setBridgeConnected(false)); }, 30_000);
    return () => window.clearInterval(heartbeat);
  }, [bridgeToken, bridgeFetch]);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const open = window.setTimeout(() => setDoorOpen(true), 350);
    const walk = window.setTimeout(() => setPlayer({ x: 50, y: 77, facing: "up" }), 850);
    const done = window.setTimeout(() => { setEntering(false); setDoorOpen(false); mapRef.current?.focus(); }, 2000);
    return () => { clearTimeout(open); clearTimeout(walk); clearTimeout(done); };
  }, []);
  useEffect(() => { if (chatOpen) window.setTimeout(() => inputRef.current?.focus(), 80); }, [chatOpen]);
  const duration = useMemo(() => snapshot.startedAt ? Math.max(0, Math.round(((snapshot.completedAt ? new Date(snapshot.completedAt).getTime() : now) - new Date(snapshot.startedAt).getTime()) / 1000)) : 0, [snapshot.startedAt, snapshot.completedAt, now]);
  const latestEvents = snapshot.events.slice(-12).reverse();
  const runningTasks = snapshot.tasks.filter((task) => task.state === "working" || task.state === "starting");
  const visibleTasks = [...snapshot.tasks].reverse().slice(0, 10);
  const selectedTask = snapshot.tasks.find((task)=>task.id===selectedTaskId) || [...snapshot.tasks].reverse().find((task)=>task.workspace===snapshot.workspace) || null;
  const activeProject = snapshot.projects.find((project)=>project.id===snapshot.workspace) || null;
  const chatMessages = selectedTask?.chat?.length ? selectedTask.chat : messages;
  const displayAgents = useMemo(() => {
    if (bridgeConnected && snapshot.agents.length) return snapshot.agents;
    return officeRoster.slice(0,snapshot.pool?.maxAgents||10).map((profile)=>({...profile,state:"offline",tool:null,taskId:null,projectName:null}));
  }, [bridgeConnected, snapshot.agents, snapshot.pool?.maxAgents]);
  const deskWorkload = useMemo(() => {
    const allEvents = snapshot.tasks.flatMap((task)=>task.events);
    const records = allEvents.map((event) => `${event.kind} ${event.label} ${event.detail}`.toLowerCase());
    const count = (pattern: RegExp) => records.filter((record) => pattern.test(record)).length;
    const cap = (value: number) => Math.max(0, Math.min(5, value));
    const active = new Set(displayAgents.filter((agent) => agent.state === "working").map((agent) => agent.id));
    const withActiveFloor = (id: string, value: number) => cap(active.has(id) ? Math.max(2, value) : value);
    const taskActive = runningTasks.length > 0;
    const changedFileCount = snapshot.tasks.reduce((sum,task)=>sum+task.changedFiles.length,0);
    return {
      codex: cap(taskActive ? Math.max(1, Math.ceil(allEvents.length / 3)) : Math.ceil(allEvents.length / 9)),
      scout: withActiveFloor("scout", count(/web|search|browse|検索|調査/)),
      mika: withActiveFloor("mika", count(/patch|file|edit|command|変更|更新/) + changedFileCount),
      reviewer: withActiveFloor("reviewer", count(/review|diff|check|lint|レビュー|確認/)),
      sora: withActiveFloor("sora", count(/test|build|vitest|playwright|テスト|ビルド/)),
    };
  }, [snapshot.tasks, runningTasks.length, displayAgents]);
  const deskLevels = [deskWorkload.codex,deskWorkload.scout,deskWorkload.mika,deskWorkload.reviewer,deskWorkload.sora,...displayAgents.slice(5,10).map((agent)=>agent.state==="working"?3:0)];
  const deskTones = ["gold","blue","green","purple","red","blue","green","purple","red","gold"];

  const move = useCallback((dx: number, dy: number, facing: Facing) => {
    if (chatOpen) return;
    setPlayer((current) => { const next = { x: Math.max(3, Math.min(97, current.x + dx)), y: Math.max(10, Math.min(92, current.y + dy)), facing }; return blocked(next.x, next.y) ? { ...current, facing } : next; });
  }, [chatOpen]);
  const talk = useCallback(() => { if (nearCodex) setChatOpen(true); }, [nearCodex]);

  async function pairBridge(event: FormEvent) {
    event.preventDefault(); if (pairingBusy || pairingCode.length !== 6) return;
    setPairingBusy(true); setPairingMessage("");
    try {
      const response = await fetch(`${BRIDGE}/pair`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ code:pairingCode }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "ペアリングできませんでした");
      bridgeTokenRef.current = result.token; window.sessionStorage.setItem("codex-office-bridge-token", result.token); setBridgeToken(result.token); setPairingRequired(false); setPairingCode("");
      if (!result.codex?.found) setPairingMessage("Codexを検出できません。ChatGPTアプリまたはCodex CLIを確認してください。");
    } catch (error) { setPairingMessage(error instanceof Error ? error.message : "Bridgeへ接続できません"); }
    finally { setPairingBusy(false); }
  }

  function requestSharedSession() {
    const requestId = window.crypto.randomUUID(); bridgeRequestRef.current = requestId;
    bridgeChannelRef.current?.postMessage({ type:"session-request", requestId });
    setPairingMessage("接続済みのOfficeタブを探しています。見つからない場合はBridge画面の新しいコードを入力してください。");
  }

  async function unpairBridge() {
    try { await bridgeFetch("/unpair", { method:"POST" }); } catch {}
    clearPairing(); setSnapshot(emptySnapshot); setPairingMessage("接続を解除しました。Bridgeに表示された新しいコードを入力してください。");
  }

  async function activateProject(projectPath: string, taskId: string | null = null) {
    setSelectedTaskId(taskId);
    setMessages([]);
    if (!bridgeConnected || projectPath === snapshot.workspace) return;
    try {
      const response = await bridgeFetch("/workspace/activate", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ path:projectPath }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "プロジェクトを切り替えられませんでした");
      setSnapshot(result.snapshot);
    } catch (error) {
      setMessages((current)=>[...current,{from:"system",text:error instanceof Error ? error.message : "プロジェクト切替エラー"}]);
    }
  }

  function addAttachments(files: FileList | File[]) {
    const incoming = Array.from(files);
    setAttachments((current) => {
      const unique = [...current];
      for (const file of incoming) {
        if (unique.length >= 5) break;
        if (file.size > 10 * 1024 * 1024) { setMessages((messages) => [...messages, { from:"system", text:`${file.name} は10MBを超えているため添付できません。` }]); continue; }
        if (!unique.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) unique.push(file);
      }
      if (unique.reduce((sum,file)=>sum+file.size,0)>25*1024*1024) { setMessages((messages)=>[...messages,{from:"system",text:"添付ファイルの合計上限は25MBです。"}]); return current; }
      return unique;
    });
  }

  function encodeFile(file: File) {
    return new Promise<{ name: string; type: string; data: string }>((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload = () => resolve({ name:file.name, type:file.type||"application/octet-stream", data:String(reader.result).split(",")[1]||"" });
      reader.onerror = () => reject(new Error(`${file.name} を読み込めませんでした`));
      reader.readAsDataURL(file);
    });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (chatOpen) { if (event.key === "Escape") setChatOpen(false); return; }
      const map: Record<string, [number, number, Facing]> = { arrowup:[0,-2.6,"up"],w:[0,-2.6,"up"],arrowdown:[0,2.6,"down"],s:[0,2.6,"down"],arrowleft:[-2.2,0,"left"],a:[-2.2,0,"left"],arrowright:[2.2,0,"right"],d:[2.2,0,"right"] };
      const key = event.key.toLowerCase(); if (map[key]) { event.preventDefault(); move(...map[key]); }
      if (key === "enter" || key === " ") { event.preventDefault(); talk(); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen, entering, nearCodex, move, talk]);

  async function submitTask(event: FormEvent) {
    event.preventDefault(); const prompt = chatInput.trim(); if ((!prompt && !attachments.length) || submitting) return;
    if (!bridgeConnected) { setMessages((current) => [...current, { from:"system", text:"ローカルブリッジが未接続です。npm run bridge を起動してください。" }]); return; }
    if (!snapshot.workspace) { setMessages((current) => [...current, { from:"system", text:"先に画面右上のPROJECT SANDBOXから、Officeとは別のプロジェクトフォルダーを選択してください。" }]); return; }
    const files = [...attachments]; const requestText = prompt || "添付ファイルを確認してください。";
    setMessages((current) => [...current, { from:"you", text:`${requestText}${files.length?`\n📎 ${files.map((file)=>file.name).join(", ")}`:""}` }]); setChatInput(""); setSubmitting(true);
    try {
      let uploadId: string | null = null;
      if (files.length) {
        const encoded = await Promise.all(files.map(encodeFile));
        const upload = await bridgeFetch("/attachments", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ attachments:encoded, workspace:snapshot.workspace }) });
        const uploaded = await upload.json(); if (!upload.ok) throw new Error(uploaded.error||"ファイルを添付できませんでした");
        uploadId = uploaded.uploadId;
      }
      const response = await bridgeFetch("/task", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ prompt:requestText, uploadId, workspace:snapshot.workspace }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "タスクを開始できませんでした");
      setAttachments([]);
      setSubmitting(false);
      setSelectedTaskId(result.taskId);
      setMessages([]);
    } catch (error) { setSubmitting(false); setMessages((current) => [...current, { from:"system", text:error instanceof Error ? error.message : "接続エラー" }]); }
  }

  async function integrateParallelTask(task: ParallelTask) {
    try {
      const response = await bridgeFetch("/task/integrate", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ taskId:task.id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "隔離作業を統合できませんでした");
      setSelectedTaskId(task.id); setMessages([]);
    } catch (error) { setMessages((current)=>[...current,{from:"system",text:error instanceof Error?error.message:"統合エラー"}]); setChatOpen(true); }
  }

  const statusLabel = !bridgeConnected ? "未接続" : !snapshot.workspace ? "PROJECT未選択" : snapshot.taskState === "working" || snapshot.taskState === "starting" ? "実行中" : snapshot.taskState === "queued" ? "割当待ち" : snapshot.taskState === "ready" ? "統合待ち" : snapshot.taskState === "complete" ? "完了" : snapshot.taskState;

  return <main className="office-app real-runtime">
    <header className="office-topbar">
      <div className="office-brand"><span>C</span><div><b>CODEX & CO.</b><small>REAL RUNTIME OFFICE</small></div></div>
      <div className="office-title"><i className={`live-dot ${bridgeConnected ? "" : "offline"}`} />{bridgeConnected ? "ローカルCodex接続中" : "ローカルブリッジ未接続"}</div>
      <div className="office-meta"><WorkspacePicker workspace={snapshot.workspace} connected={bridgeConnected} projects={snapshot.projects} bridgeToken={bridgeToken} pool={snapshot.pool} onAgentCountChanged={(maxAgents)=>setSnapshot((current)=>({...current,pool:{...(current.pool||{activeAgents:0,queuedTasks:0,worktreesEnabled:true,maxAgents}),maxAgents}}))} onWorkspaceChanged={(workspace,projects)=>{setSelectedTaskId(null);setMessages([]);setSnapshot((current)=>({...current,workspace,projects:projects||current.projects}));}}/><a className="source-link" href="https://github.com/CatwalkTK/codex-agent-office" target="_blank" rel="noreferrer">SOURCE · AGPL</a>{bridgeConnected&&<button className="bridge-session-button" type="button" onClick={()=>void unpairBridge()} title="Bridgeとの接続を解除">PAIRED · 解除</button>}<span>{snapshot.session ? snapshot.session.slice(-18) : "NO SESSION"}</span><div className="user-chip">J</div></div>
    </header>

    <section className="office-stage">
      <div className="game-status"><div><small>RUNTIME</small><b>{statusLabel}</b><span>{snapshot.currentTool || "toolなし"}</span></div><div><small>ISOLATED PROJECT</small><b>{activeProject?.name || (snapshot.workspace ? "外部プロジェクト" : "右上から外部プロジェクトを選択してください")}</b></div><div className="pool-badge"><small>AGENT POOL</small><b>{snapshot.pool?.activeAgents||0}/{snapshot.pool?.maxAgents||displayAgents.length}</b><span>QUEUE {snapshot.pool?.queuedTasks||0}</span></div><div className={bridgeConnected && snapshot.workspace ? "online" : "online disconnected"}><i />{!bridgeConnected ? "BRIDGE OFFLINE" : snapshot.workspace ? "SYSTEM PROTECTED · SANDBOX ON" : "SELECT EXTERNAL PROJECT"}</div></div>
      <div className="office-map" ref={mapRef} tabIndex={0} aria-label="オフィス。WASDまたは矢印キーで移動" onPointerDown={() => mapRef.current?.focus()}>
        <div className="windows"><i /><i /><i /><i /></div>
        <div className="office-floor-title">CODEX & CO. · OPEN OFFICE FLOOR</div>
        {displayAgents.slice(0,10).map((agent,index)=>{const position=departmentDeskPositions[index];return <div className={`department-desk ${index===0?"boss":""} ${agent.state==="working"?"active":""}`} style={{left:`${position.x}%`,top:`${position.y}%`}} key={`desk-${agent.id}`}><span className="room-sign">{position.room}</span><div className="department-monitor"><i /></div><b>{agent.name}</b><small>{agent.state==="working"?agent.projectName||"TASK IN PROGRESS":agent.role}</small><DeskDocuments level={deskLevels[index]||0} label={index===0?"INBOX":"WORK"} tone={deskTones[index]} active={agent.state==="working"} /></div>})}
        <div className="meeting-zone"><span>PROJECT TABLE</span><div className="meeting-table"><i/><i/><i/><i/><i/><i/></div><b>共有会議・オーケストレーション</b></div>
        {displayAgents.length>10&&<div className="remote-floor">2F ANNEX <b>+{displayAgents.length-10}</b><span>リモート席で稼働</span></div>}
        <div className="visual-work-legend"><span><i className="legend-paper" />資料量＝実イベント数</span><span><i className="legend-route" />黄色枠＝担当稼働中</span></div>
        <div className="office-plant plant-left"><i /><b /></div><div className="office-plant plant-right"><i /><b /></div><div className="server-rack"><i /><i /><i /><b /></div>
        <div className={`auto-door ${doorOpen ? "open" : ""}`}><div className="door-sign">AUTO · ENTRANCE</div><i className="door-left" /><i className="door-right" /><b className="door-sensor" /></div>
        <div className="move-help"><div><span>YOU</span><b>青いラベルがあなたです</b><small>WASD／矢印キー、または右下ボタンで移動</small></div><button onClick={()=>setPlayer({x:50,y:77,facing:"up"})}>入口へ戻る</button></div>
        {displayAgents.slice(0,10).map((agent,index)=><RuntimeCharacter agent={agent} index={index} key={agent.id} />)}
        <div className={`business-player image-player face-${player.facing} ${entering ? "entering" : ""}`} style={{left:`${player.x}%`,top:`${player.y}%`}}><div className="player-arrow">YOU ▼</div><div className="player-art" /></div>
        {nearCodex && !chatOpen && <button className="talk-prompt" onClick={talk}><kbd>ENTER</kbd><span>Codexへ実タスクを依頼</span></button>}
        <div className="movement-pad"><button onClick={()=>move(0,-2.6,"up")}>▲</button><button onClick={()=>move(-2.2,0,"left")}>◀</button><button className={nearCodex?"can-talk":""} onClick={talk}>A</button><button onClick={()=>move(2.2,0,"right")}>▶</button><button onClick={()=>move(0,2.6,"down")}>▼</button></div>
        <div className="real-event-strip"><b>{snapshot.taskState === "working" ? "● LIVE" : "STATUS"}</b><span>{latestEvents[0]?.label || (bridgeConnected ? "イベント待機中" : "ブリッジを起動してください")}</span><em>{latestEvents[0]?.detail || ""}</em></div>
      </div>
      <div className="control-hint"><span><kbd>WASD</kbd> / <kbd>矢印</kbd> 移動</span><span><kbd>ENTER</kbd> Codexへ指示</span><span>外部プロジェクト限定 · Office本体は保護</span></div>
    </section>

    <aside className="dev-monitor">
      <header><div><i className={`live-dot ${bridgeConnected?"":"offline"}`} /><b>REAL DEV MONITOR</b></div><span>{bridgeConnected ? `${runningTasks.length} PARALLEL` : "OFFLINE"}</span></header>
      <section className="source-window"><div className="window-bar"><span>EXTERNAL PROJECT SOURCE</span><div><i /><i /><i /></div></div><div className="file-tabs"><button className="active"><i>FILE</i>{snapshot.source.path || "プロジェクト未選択"}</button></div><div className="code-breadcrumb">{snapshot.currentFile || snapshot.source.path || "No external source"}</div><pre className="code-view"><code>{snapshot.source.lines.length ? snapshot.source.lines.map((line,index)=><span key={index}><em>{String(index+1).padStart(2,"0")}</em><b>{line||" "}</b></span>) : <span><em>--</em><b>{snapshot.workspace?"実ファイルはまだ取得されていません":"外部プロジェクトを選択してください"}</b></span>}</code></pre><div className="code-status"><span>{snapshot.changedFiles.length} changed files</span><span>SANDBOXED</span></div></section>
      <section className="runtime-window"><div className="window-bar"><span>CODEX EVENTS</span><div className={`running-badge ${bridgeConnected?"":"offline"}`}><i />{statusLabel}</div></div><div className="runtime-summary"><div><small>STATE</small><b>{snapshot.taskState}</b></div><div><small>ELAPSED</small><b>{Math.floor(duration/60)}:{String(duration%60).padStart(2,"0")}</b></div><div><small>FILES</small><b>{snapshot.changedFiles.length}</b></div></div><div className="terminal-output real-events">{latestEvents.length ? latestEvents.map((item)=><div className={item.status} key={item.id}><span>{item.status==="success"?"✓":item.status==="error"?"!":"·"}</span><code>{formatTime(item.time)}  {item.label}{item.detail?` · ${item.detail}`:""}</code></div>) : <div><span>·</span><code>{bridgeConnected?"実イベントを待機しています":"ローカルブリッジに接続できません"}</code></div>}</div><div className="terminal-command"><span>❯</span><code>{snapshot.currentTool || (bridgeConnected?"idle":"npm run bridge")}</code>{snapshot.taskState==="working"&&<i />}</div></section>
      <section className="project-queue"><div className="project-queue-head"><span>PROJECT TASKS · CLICK TO SWITCH CHAT</span><b>{runningTasks.length} running · {snapshot.pool?.queuedTasks||0} queued</b></div><div className="project-task-list">{visibleTasks.length ? visibleTasks.map((task)=><div className="project-task-row" key={task.id}><button type="button" className={`${task.state} ${task.workspace===snapshot.workspace?"active":""} ${task.id===selectedTask?.id?"selected":""}`} onClick={()=>void activateProject(task.workspace,task.id)} title={`${task.workspace}\n${task.prompt}`}><i className={`project-state ${task.state}`}/><span><b>{task.projectName} · {task.agentName||(task.state==="queued"?"割当待ち":"Codex")}</b><small>{task.currentTool || task.prompt || task.state}</small><em><u style={{width:`${task.progress}%`}}/></em></span><strong>{task.progress}%</strong><mark>{task.changedFiles.length}F</mark></button>{task.integrationPending&&<button type="button" className="integrate-task" onClick={()=>void integrateParallelTask(task)} title="隔離worktreeの変更を本体プロジェクトへ統合">統合</button>}</div>) : snapshot.projects.map((project)=><button type="button" key={project.path} className={project.path===snapshot.workspace?"active":""} onClick={()=>void activateProject(project.path)}><i className="project-state idle"/><span><b>{project.name}</b><small>タスク待機中</small><em><u style={{width:"0%"}}/></em></span><strong>0%</strong><mark>0F</mark></button>)}</div></section>
      <section className="agent-now"><div className="agent-now-head"><span>REAL CODEX AGENT POOL</span><b>{displayAgents.filter(agent=>agent.state==="working"||agent.state==="starting").length}/{displayAgents.length} active</b></div>{displayAgents.map((agent)=><div key={agent.id}><i className={`agent-state-dot ${agent.state}`} /><span><b>{agent.name}{agent.projectName?` · ${agent.projectName}`:""}</b><small>{agent.tool||agent.role}</small></span><em className={agent.state==="working"||agent.state==="starting"?"working":""}>{agent.state}</em></div>)}</section>
    </aside>

    {pairingRequired&&<div className="pairing-backdrop"><section className="pairing-dialog" role="dialog" aria-modal="true" aria-labelledby="pairing-title"><div className="pairing-lock">⌁</div><small>LOCAL BRIDGE SECURITY</small><h2 id="pairing-title">このPCのBridgeと接続</h2><p>Bridgeを起動したターミナル、または <a href="http://127.0.0.1:4312/" target="_blank" rel="noreferrer">ローカルBridge画面</a> に表示される6桁コードを入力してください。Bridgeが接続済みと表示されていても、新しいコードを使用できます。</p><form onSubmit={pairBridge}><label htmlFor="pairing-code">PAIRING CODE</label><input id="pairing-code" value={pairingCode} onChange={(event)=>setPairingCode(event.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus/><button type="submit" disabled={pairingBusy||pairingCode.length!==6}>{pairingBusy?"接続中…":"Bridgeへ接続"}</button><button className="inherit-session" type="button" onClick={requestSharedSession}>接続済みタブから引き継ぐ</button></form>{pairingMessage&&<div className="pairing-message">{pairingMessage}</div>}<footer><span>コード＋ローカル確認で接続</span><span>危険な操作は毎回Mac側で再確認</span></footer></section></div>}

    {chatOpen&&<div className="chat-backdrop"><section className="boss-chat" role="dialog" aria-modal="true">
      <header><div className="chat-portrait image-portrait"/><div><small>{selectedTask?`TASK CHAT · ${selectedTask.id.slice(-6)}`:"NEW ISOLATED TASK"}</small><h2>{selectedTask?selectedTask.projectName:"Codexへ指示"}</h2><span><i className={bridgeConnected&&snapshot.workspace?"":"offline"}/>{!bridgeConnected?"ブリッジ未接続":selectedTask?`${selectedTask.state} · ${selectedTask.progress}% · ${selectedTask.currentTool||"待機"}`:snapshot.workspace?"新しいタスクを開始できます":"外部プロジェクト未選択"}</span></div><button onClick={()=>setChatOpen(false)}>×</button></header>
      <div className="chat-log" key={selectedTask?.id||"new"} data-task-id={selectedTask?.id||"new"}>{chatMessages.length?chatMessages.map((message,index)=><div className={`chat-message ${message.from}`} key={message.id||index}><b>{message.from==="you"?"あなた":message.from==="codex"?(selectedTask?.agentName||"Codex"):"System"}</b><ChatMarkdown text={message.text}/></div>):<div className="chat-empty">{snapshot.workspace?"新しい指示を送るか、右側のタスクを選択すると、そのタスク専用のチャット履歴が表示されます。":"右上のPROJECTSから外部プロジェクトを選択してください。"}</div>}{(submitting||selectedTask?.state==="working"||selectedTask?.state==="starting"||selectedTask?.state==="queued")&&<div className="chat-message codex pending"><b>{selectedTask?.agentName||"ORCHESTRATOR"}</b><p>{submitting?"タスクを登録しています…":selectedTask?.state==="queued"?"空いているエージェントへの割り当てを待っています…":`${selectedTask?.currentTool||"処理"}を実行中… ${selectedTask?.progress||0}%`}</p></div>}</div>
      <form className="chat-composer" onSubmit={submitTask} onDragOver={(event)=>event.preventDefault()} onDrop={(event)=>{event.preventDefault();if(snapshot.workspace)addAttachments(event.dataTransfer.files)}}>{attachments.length>0&&<div className="attachment-list">{attachments.map((file,index)=><div key={`${file.name}-${file.lastModified}`}><span>▤</span><b>{file.name}</b><small>{file.size<1024*1024?`${Math.ceil(file.size/1024)}KB`:`${(file.size/1024/1024).toFixed(1)}MB`}</small><button type="button" onClick={()=>setAttachments((current)=>current.filter((_,itemIndex)=>itemIndex!==index))} aria-label={`${file.name}を削除`}>×</button></div>)}</div>}<div className="chat-compose-row"><label className="attachment-button" aria-label="ファイルを添付">📎<span>ファイル</span><input type="file" multiple disabled={submitting||!snapshot.workspace} onChange={(event)=>{if(event.target.files)addAttachments(event.target.files);event.target.value=""}}/></label><input className="task-input" ref={inputRef} value={chatInput} onChange={(event)=>setChatInput(event.target.value)} placeholder={activeProject?`${activeProject.name}で新しいタスクを開始…`:"先に外部プロジェクトを選択"} disabled={submitting||!snapshot.workspace}/><button type="submit" disabled={submitting||!snapshot.workspace||(!chatInput.trim()&&!attachments.length)}>新規実行 ↗</button></div><small className="attachment-hint">表示中の履歴はタスク専用 · ファイル保存と実行はMac側で個別確認</small></form>
      <footer><span>右側のタスクをクリックしてチャット切替</span><span>{selectedTask?selectedTask.id:"NEW TASK"}</span></footer>
    </section></div>}
  </main>;
}
