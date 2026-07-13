"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Facing = "up" | "down" | "left" | "right";
type Point = { x: number; y: number; facing: Facing };
type RuntimeEvent = { id: string; time: string; kind: string; label: string; detail: string; status: string };
type AgentState = { id: string; name: string; role: string; state: string; tool: string | null };
type Snapshot = {
  connected: boolean; workspace: string; session: string | null; taskState: string; currentTool: string | null; currentFile: string | null;
  lastAgentMessage: string; taskPrompt: string; startedAt: string | null; completedAt: string | null; changedFiles: string[];
  events: RuntimeEvent[]; source: { path: string; lines: string[] }; agents: AgentState[];
};
type ChatMessage = { from: "you" | "codex" | "system"; text: string };

const BRIDGE = "http://127.0.0.1:4312";
const emptySnapshot: Snapshot = { connected: false, workspace: "", session: null, taskState: "disconnected", currentTool: null, currentFile: null, lastAgentMessage: "", taskPrompt: "", startedAt: null, completedAt: null, changedFiles: [], events: [], source: { path: "", lines: [] }, agents: [] };
const agentPositions = [{ x: 50, y: 14 }, { x: 20, y: 15 }, { x: 80, y: 15 }, { x: 28, y: 55 }, { x: 73, y: 55 }];
const officeRoster = [
  { id:"codex", name:"Codex", role:"上司・統括" }, { id:"scout", name:"Scout", role:"検索・調査ロール" },
  { id:"mika", name:"Mika", role:"編集・実装ロール" }, { id:"reviewer", name:"Reviewer", role:"レビュー担当ロール" }, { id:"sora", name:"Sora", role:"テスト担当ロール" },
];
const obstacles = [
  { x1: 39, x2: 61, y1: 17, y2: 32 }, { x1: 10, x2: 30, y1: 18, y2: 36 }, { x1: 70, x2: 89, y1: 18, y2: 36 },
  { x1: 17, x2: 39, y1: 59, y2: 72 }, { x1: 62, x2: 84, y1: 59, y2: 72 }, { x1: 7, x2: 25, y1: 67, y2: 82 }, { x1: 89, x2: 97, y1: 58, y2: 82 },
];

function RuntimeCharacter({ agent, index }: { agent: AgentState; index: number }) {
  const position = agentPositions[index] || { x: 50 + (index % 3) * 12, y: 45 + Math.floor(index / 3) * 20 };
  const spriteIndex = index === 0 ? 1 : Math.min(index + 1, 5);
  return <div className={`npc image-npc runtime-npc state-${agent.state}`} style={{ left: `${position.x}%`, top: `${position.y}%` }}>
    {index === 0 && <div className="manager-badge">CODEX</div>}
    <div className="npc-art" style={{ backgroundPosition: `${spriteIndex * 20}% 50%` }} />
    <div className="npc-tag"><b>{agent.name}</b><span>{agent.tool || agent.state}</span></div>
    {agent.state === "working" && <div className="work-spark">•••</div>}
  </div>;
}

function formatTime(value: string) {
  try { return new Date(value).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); } catch { return "--:--:--"; }
}

export function OfficeDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [player, setPlayer] = useState<Point>({ x: 50, y: 98, facing: "up" });
  const [entering, setEntering] = useState(true);
  const [doorOpen, setDoorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const lastReply = useRef("");
  const nearCodex = Math.hypot(player.x - 50, player.y - 37) < 10;

  useEffect(() => {
    const stream = new EventSource(`${BRIDGE}/events`);
    stream.onmessage = (event) => { try { setSnapshot(JSON.parse(event.data)); setBridgeConnected(true); } catch {} };
    stream.onerror = () => setBridgeConnected(false);
    return () => stream.close();
  }, []);

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const open = window.setTimeout(() => setDoorOpen(true), 350);
    const walk = window.setTimeout(() => setPlayer({ x: 50, y: 84, facing: "up" }), 850);
    const done = window.setTimeout(() => { setEntering(false); setDoorOpen(false); mapRef.current?.focus(); }, 2000);
    return () => { clearTimeout(open); clearTimeout(walk); clearTimeout(done); };
  }, []);
  useEffect(() => { if (chatOpen) window.setTimeout(() => inputRef.current?.focus(), 80); }, [chatOpen]);
  useEffect(() => {
    if (snapshot.lastAgentMessage && snapshot.lastAgentMessage !== lastReply.current) {
      lastReply.current = snapshot.lastAgentMessage;
      setMessages((current) => [...current, { from: "codex", text: snapshot.lastAgentMessage }]);
      setSubmitting(false);
    }
  }, [snapshot.lastAgentMessage]);

  const duration = useMemo(() => snapshot.startedAt ? Math.max(0, Math.round(((snapshot.completedAt ? new Date(snapshot.completedAt).getTime() : now) - new Date(snapshot.startedAt).getTime()) / 1000)) : 0, [snapshot.startedAt, snapshot.completedAt, now]);
  const latestEvents = snapshot.events.slice(-12).reverse();
  const displayAgents = useMemo(() => {
    const text = `${snapshot.currentTool || ""} ${latestEvents[0]?.kind || ""} ${latestEvents[0]?.label || ""} ${latestEvents[0]?.detail || ""}`.toLowerCase();
    return officeRoster.map((profile,index) => {
      if (index === 0) return { ...profile, state: snapshot.agents[0]?.state || (bridgeConnected ? "idle" : "offline"), tool: snapshot.currentTool };
      const active = snapshot.taskState === "working" && (
        (profile.id === "scout" && /web|search|検索|調査/.test(text)) ||
        (profile.id === "mika" && /patch|file|edit|command|変更|更新/.test(text)) ||
        (profile.id === "reviewer" && /review|diff|check|lint|レビュー|確認/.test(text)) ||
        (profile.id === "sora" && /test|build|vitest|playwright|テスト|ビルド/.test(text))
      );
      return { ...profile, state: !bridgeConnected ? "offline" : active ? "working" : "idle", tool: active ? (snapshot.currentTool || latestEvents[0]?.label || null) : null };
    });
  }, [snapshot.agents, snapshot.currentTool, snapshot.taskState, latestEvents, bridgeConnected]);

  function blocked(x: number, y: number) { return obstacles.some((o) => x > o.x1 && x < o.x2 && y > o.y1 && y < o.y2); }
  function move(dx: number, dy: number, facing: Facing) {
    if (chatOpen) return;
    setPlayer((current) => { const next = { x: Math.max(3, Math.min(97, current.x + dx)), y: Math.max(10, Math.min(92, current.y + dy)), facing }; return blocked(next.x, next.y) ? { ...current, facing } : next; });
  }
  function talk() { if (nearCodex) setChatOpen(true); }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (chatOpen) { if (event.key === "Escape") setChatOpen(false); return; }
      const map: Record<string, [number, number, Facing]> = { arrowup:[0,-2.6,"up"],w:[0,-2.6,"up"],arrowdown:[0,2.6,"down"],s:[0,2.6,"down"],arrowleft:[-2.2,0,"left"],a:[-2.2,0,"left"],arrowright:[2.2,0,"right"],d:[2.2,0,"right"] };
      const key = event.key.toLowerCase(); if (map[key]) { event.preventDefault(); move(...map[key]); }
      if (key === "enter" || key === " ") { event.preventDefault(); talk(); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen, entering, nearCodex]);

  async function submitTask(event: FormEvent) {
    event.preventDefault(); const prompt = chatInput.trim(); if (!prompt || submitting) return;
    if (!bridgeConnected) { setMessages((current) => [...current, { from:"system", text:"ローカルブリッジが未接続です。npm run bridge を起動してください。" }]); return; }
    setMessages((current) => [...current, { from:"you", text:prompt }]); setChatInput(""); setSubmitting(true);
    try {
      const response = await fetch(`${BRIDGE}/task`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ prompt }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "タスクを開始できませんでした");
      setMessages((current) => [...current, { from:"system", text:"実際のCodexタスクを開始しました。完了まで実行イベントを表示します。" }]);
    } catch (error) { setSubmitting(false); setMessages((current) => [...current, { from:"system", text:error instanceof Error ? error.message : "接続エラー" }]); }
  }

  const statusLabel = !bridgeConnected ? "未接続" : snapshot.taskState === "working" || snapshot.taskState === "starting" ? "実行中" : snapshot.taskState === "complete" ? "完了" : snapshot.taskState;

  return <main className="office-app real-runtime">
    <header className="office-topbar">
      <div className="office-brand"><span>C</span><div><b>CODEX & CO.</b><small>REAL RUNTIME OFFICE</small></div></div>
      <div className="office-title"><i className={`live-dot ${bridgeConnected ? "" : "offline"}`} />{bridgeConnected ? "ローカルCodex接続中" : "ローカルブリッジ未接続"}</div>
      <div className="office-meta"><span>{snapshot.session ? snapshot.session.slice(-18) : "NO SESSION"}</span><div className="user-chip">J</div></div>
    </header>

    <section className="office-stage">
      <div className="game-status"><div><small>RUNTIME</small><b>{statusLabel}</b><span>{snapshot.currentTool || "toolなし"}</span></div><div><small>REAL TASK</small><b>{snapshot.taskPrompt || "Codexへの指示を待っています"}</b></div><div className={bridgeConnected ? "online" : "online disconnected"}><i />{bridgeConnected ? `5 OFFICE ROLES · ${snapshot.agents.length} REAL AGENT` : "BRIDGE OFFLINE"}</div></div>
      <div className="office-map" ref={mapRef} tabIndex={0} aria-label="オフィス。WASDまたは矢印キーで移動" onPointerDown={() => mapRef.current?.focus()}>
        <div className="windows"><i /><i /><i /><i /></div>
        <div className="zone-label executive">CODEX DESK</div><div className="zone-label product">WORKSPACE</div><div className="zone-label qa">CHANGES</div>
        <div className="executive-desk"><div className="wide-monitor"><i /></div><i className="laptop" /><i className="coffee" /><span>CODEX</span></div>
        <div className="workstation ws-left"><div className="monitor"><i /></div><div className="chair" /><span className="desk-name">SCOUT</span></div><div className="workstation ws-right"><div className="monitor"><i /></div><div className="chair" /><span className="desk-name">MIKA</span></div>
        <div className="agent-desk desk-review"><div className="monitor"><i /></div><div className="desk-chair" /><span>REVIEWER</span></div><div className="agent-desk desk-test"><div className="monitor"><i /></div><div className="desk-chair" /><span>SORA</span></div>
        <div className="office-sofa"><i /><i /><span /></div><div className="office-plant plant-left"><i /><b /></div><div className="office-plant plant-right"><i /><b /></div><div className="server-rack"><i /><i /><i /><b /></div>
        <div className={`auto-door ${doorOpen ? "open" : ""}`}><div className="door-sign">AUTO · ENTRANCE</div><i className="door-left" /><i className="door-right" /><b className="door-sensor" /></div>
        {displayAgents.map((agent,index)=><RuntimeCharacter agent={agent} index={index} key={agent.id} />)}
        <div className={`business-player image-player face-${player.facing} ${entering ? "entering" : ""}`} style={{left:`${player.x}%`,top:`${player.y}%`}}><div className="player-arrow">YOU ▼</div><div className="player-art" /></div>
        {nearCodex && !chatOpen && <button className="talk-prompt" onClick={talk}><kbd>ENTER</kbd><span>Codexへ実タスクを依頼</span></button>}
        <div className="movement-pad"><button onClick={()=>move(0,-2.6,"up")}>▲</button><button onClick={()=>move(-2.2,0,"left")}>◀</button><button className={nearCodex?"can-talk":""} onClick={talk}>A</button><button onClick={()=>move(2.2,0,"right")}>▶</button><button onClick={()=>move(0,2.6,"down")}>▼</button></div>
        <div className="real-event-strip"><b>{snapshot.taskState === "working" ? "● LIVE" : "STATUS"}</b><span>{latestEvents[0]?.label || (bridgeConnected ? "イベント待機中" : "ブリッジを起動してください")}</span><em>{latestEvents[0]?.detail || ""}</em></div>
      </div>
      <div className="control-hint"><span><kbd>WASD</kbd> / <kbd>矢印</kbd> 移動</span><span><kbd>ENTER</kbd> Codexへ指示</span><span>表示データ: Codex JSONL + Git + 実ファイル</span></div>
    </section>

    <aside className="dev-monitor">
      <header><div><i className={`live-dot ${bridgeConnected?"":"offline"}`} /><b>REAL DEV MONITOR</b></div><span>{bridgeConnected?"CONNECTED":"OFFLINE"}</span></header>
      <section className="source-window"><div className="window-bar"><span>ACTUAL SOURCE</span><div><i /><i /><i /></div></div><div className="file-tabs"><button className="active"><i>FILE</i>{snapshot.source.path || "接続待ち"}</button></div><div className="code-breadcrumb">{snapshot.currentFile || snapshot.source.path || "No source"}</div><pre className="code-view"><code>{snapshot.source.lines.length ? snapshot.source.lines.map((line,index)=><span key={index}><em>{String(index+1).padStart(2,"0")}</em><b>{line||" "}</b></span>) : <span><em>--</em><b>実ファイルはまだ取得されていません</b></span>}</code></pre><div className="code-status"><span>{snapshot.changedFiles.length} changed files</span><span>READ ONLY</span></div></section>
      <section className="runtime-window"><div className="window-bar"><span>CODEX EVENTS</span><div className={`running-badge ${bridgeConnected?"":"offline"}`}><i />{statusLabel}</div></div><div className="runtime-summary"><div><small>STATE</small><b>{snapshot.taskState}</b></div><div><small>ELAPSED</small><b>{Math.floor(duration/60)}:{String(duration%60).padStart(2,"0")}</b></div><div><small>FILES</small><b>{snapshot.changedFiles.length}</b></div></div><div className="terminal-output real-events">{latestEvents.length ? latestEvents.map((item)=><div className={item.status} key={item.id}><span>{item.status==="success"?"✓":item.status==="error"?"!":"·"}</span><code>{formatTime(item.time)}  {item.label}{item.detail?` · ${item.detail}`:""}</code></div>) : <div><span>·</span><code>{bridgeConnected?"実イベントを待機しています":"ローカルブリッジに接続できません"}</code></div>}</div><div className="terminal-command"><span>❯</span><code>{snapshot.currentTool || (bridgeConnected?"idle":"npm run bridge")}</code>{snapshot.taskState==="working"&&<i />}</div></section>
      <section className="agent-now"><div className="agent-now-head"><span>OFFICE ROLES · REAL EVENT MAPPING</span><b>{displayAgents.filter(agent=>agent.state==="working").length} active</b></div>{displayAgents.map((agent)=><div key={agent.id}><i className={`agent-state-dot ${agent.state}`} /><span><b>{agent.name}</b><small>{agent.tool||agent.role}</small></span><em className={agent.state==="working"?"working":""}>{agent.state}</em></div>)}</section>
    </aside>

    {chatOpen&&<div className="chat-backdrop"><section className="boss-chat" role="dialog" aria-modal="true"><header><div className="chat-portrait image-portrait"/><div><small>REAL CODEX TASK</small><h2>Codexへ指示</h2><span><i className={bridgeConnected?"":"offline"}/>{bridgeConnected?"ローカルCLI接続済み":"ブリッジ未接続"}</span></div><button onClick={()=>setChatOpen(false)}>×</button></header><div className="chat-log">{messages.length?messages.map((message,index)=><div className={`chat-message ${message.from}`} key={index}><b>{message.from==="you"?"あなた":message.from==="codex"?"Codex":"System"}</b><p>{message.text}</p></div>):<div className="chat-empty">ここから送信した指示は、実際のCodex CLIタスクとして実行されます。</div>}{submitting&&<div className="chat-message codex pending"><b>Codex</b><p>実行中…右側に実イベントを表示しています。</p></div>}</div><form onSubmit={submitTask}><input ref={inputRef} value={chatInput} onChange={(event)=>setChatInput(event.target.value)} placeholder="実行するタスクを入力…" disabled={submitting}/><button type="submit" disabled={submitting||!chatInput.trim()}>実行 ↗</button></form><footer><span>ESCで閉じる</span><span>workspace-write sandboxで実行</span></footer></section></div>}
  </main>;
}
