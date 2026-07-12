"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Facing = "up" | "down" | "left" | "right";
type Point = { x: number; y: number; facing: Facing };
type ChatMessage = { from: "you" | "codex"; text: string };

const staff = [
  { name: "Codex", role: "統括マネージャー", state: "指揮中", x: 50, y: 14, suit: "#8b6840", col: 2, row: 0, boss: true },
  { name: "Scout", role: "リサーチ", state: "調査中", x: 20, y: 15, suit: "#35363d", col: 1, row: 0 },
  { name: "Mika", role: "UIエンジニア", state: "実装中", x: 80, y: 15, suit: "#454149", col: 1, row: 1 },
  { name: "Reviewer", role: "品質管理", state: "レビュー", x: 28, y: 55, suit: "#31443e", col: 2, row: 2 },
  { name: "Sora", role: "テスト担当", state: "待機中", x: 73, y: 55, suit: "#2d4c78", col: 3, row: 1 },
];

const obstacles = [
  { x1: 39, x2: 61, y1: 17, y2: 32 },
  { x1: 10, x2: 30, y1: 18, y2: 36 },
  { x1: 70, x2: 89, y1: 18, y2: 36 },
  { x1: 17, x2: 39, y1: 59, y2: 72 },
  { x1: 62, x2: 84, y1: 59, y2: 72 },
  { x1: 7, x2: 25, y1: 67, y2: 82 },
  { x1: 89, x2: 97, y1: 58, y2: 82 },
];

const sourceLines = [
  "export function OfficeDashboard() {",
  "  const [agents, setAgents] = useAgentRuntime();",
  "  const stream = useCodexEventStream();",
  "",
  "  useEffect(() => {",
  "    stream.on('tool.start', handleToolStart);",
  "    stream.on('file.change', refreshWorkspace);",
  "    return () => stream.disconnect();",
  "  }, [stream]);",
  "",
  "  function assignTask(agentId: string) {",
  "    runtime.dispatch({ type: 'ASSIGN_TASK', agentId });",
  "    updateOfficeState(agentId, 'working');",
  "  }",
  "",
  "  return <InteractiveOffice agents={agents} />;",
  "}",
];

const runtimeEvents = [
  ["Scout", "SEARCH", "関連コンポーネントを検索中…"],
  ["Mika", "EDIT", "OfficeDashboard.tsx を更新"],
  ["Reviewer", "CHECK", "型チェックを実行中…"],
  ["Sora", "TEST", "インタラクションテスト 12/18"],
  ["Codex", "SYNC", "エージェント状態を同期"],
];

function BusinessCharacter({ person }: { person: (typeof staff)[number] }) {
  return (
    <div className={`npc image-npc ${person.boss ? "manager" : ""}`} style={{ left: `${person.x}%`, top: `${person.y}%` }}>
      {person.boss && <div className="manager-badge">BOSS</div>}
      <div className="npc-art" style={{ backgroundPosition: `${person.col * 33.333}% ${person.row * 50}%` }} />
      <div className="npc-tag"><b>{person.name}</b><span>{person.state}</span></div>
    </div>
  );
}

function codexReply(input: string) {
  if (/進捗|状況|どう/.test(input)) return "現在はUIエンジニアが実装中、Reviewerが変更差分を確認中だ。全体進捗は68%。次の報告は完了時に届けよう。";
  if (/任せ|お願い|作って|実装/.test(input)) return `了解した。「${input}」を新しいタスクとして整理し、最適な担当エージェントへ割り当てる。`;
  if (/止め|中断|キャンセル/.test(input)) return "了解した。進行中の作業を安全な地点で停止し、変更内容を保持する。";
  return `承知した。「${input}」という指示でよいな。要件を確認し、チームへ共有する。`;
}

export function OfficeDashboard() {
  const [player, setPlayer] = useState<Point>({ x: 50, y: 98, facing: "up" });
  const [entering, setEntering] = useState(true);
  const [doorOpen, setDoorOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([{ from: "codex", text: "お疲れさまです。次の指示をどうぞ。" }]);
  const [clock, setClock] = useState("09:42");
  const [toast, setToast] = useState("");
  const [runtimeTick, setRuntimeTick] = useState(1);
  const [terminal, setTerminal] = useState(["$ codex run --workspace office-ui", "✓ Agent runtime connected", "✓ Watching 24 workspace files"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const nearCodex = Math.hypot(player.x - 50, player.y - 37) < 10;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false })), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const open = window.setTimeout(() => setDoorOpen(true), 450);
    const walkIn = window.setTimeout(() => setPlayer({ x: 50, y: 84, facing: "up" }), 1050);
    const finish = window.setTimeout(() => { setEntering(false); setDoorOpen(false); }, 3000);
    return () => { window.clearTimeout(open); window.clearTimeout(walkIn); window.clearTimeout(finish); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRuntimeTick((current) => current + 1);
      setTerminal((current) => {
        const event = runtimeEvents[(current.length - 3) % runtimeEvents.length];
        const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
        return [...current.slice(-7), `${time}  ${event[1].padEnd(6)}  ${event[0]} · ${event[2]}`];
      });
    }, 2100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (chatOpen) window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [chatOpen]);

  function flash(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(""), 1600);
  }

  function blocked(x: number, y: number) {
    const furniture = obstacles.some((o) => x > o.x1 && x < o.x2 && y > o.y1 && y < o.y2);
    const coworker = staff.slice(1).some((p) => Math.hypot(x - p.x, y - p.y) < 4.2);
    return furniture || coworker;
  }

  function move(dx: number, dy: number, facing: Facing) {
    if (chatOpen || entering) return;
    setPlayer((current) => {
      const next = { x: Math.max(3, Math.min(97, current.x + dx)), y: Math.max(10, Math.min(92, current.y + dy)), facing };
      if (blocked(next.x, next.y)) return { ...current, facing };
      return next;
    });
  }

  function talk() {
    if (nearCodex) setChatOpen(true);
    else flash("Codexのデスクまで近づいてください");
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (chatOpen) {
        if (key === "escape") setChatOpen(false);
        return;
      }
      const map: Record<string, [number, number, Facing]> = {
        arrowup: [0, -2.6, "up"], w: [0, -2.6, "up"], arrowdown: [0, 2.6, "down"], s: [0, 2.6, "down"],
        arrowleft: [-2.2, 0, "left"], a: [-2.2, 0, "left"], arrowright: [2.2, 0, "right"], d: [2.2, 0, "right"],
      };
      if (map[key]) { event.preventDefault(); move(...map[key]); }
      if (key === "enter" || key === " ") { event.preventDefault(); talk(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatOpen, nearCodex]);

  function submitChat(event: FormEvent) {
    event.preventDefault();
    const value = chatInput.trim();
    if (!value) return;
    setMessages((current) => [...current, { from: "you", text: value }, { from: "codex", text: codexReply(value) }]);
    setChatInput("");
  }

  return (
    <main className="office-app">
      <header className="office-topbar">
        <div className="office-brand"><span>C</span><div><b>CODEX & CO.</b><small>AI OPERATIONS OFFICE</small></div></div>
        <div className="office-title"><i className="live-dot" />東京本社 · 開発フロア</div>
        <div className="office-meta"><span>{clock}</span><button onClick={() => flash("通知は2件あります")}>通知 <b>2</b></button><div className="user-chip">J</div></div>
      </header>

      <section className="office-stage">
        <div className="game-status">
          <div><small>PLAYER</small><b>Jobs1</b><span>プロジェクトオーナー</span></div>
          <div><small>OBJECTIVE</small><b>{nearCodex ? "Codexと会話する" : "上司Codexのデスクへ向かう"}</b></div>
          <div className="online"><i />5 AGENTS ONLINE</div>
        </div>

        <div className="office-map">
          <div className="windows"><i /><i /><i /><i /></div>
          <div className="zone-label executive">EXECUTIVE DESK</div><div className="zone-label product">PRODUCT TEAM</div><div className="zone-label qa">QUALITY & TEST</div>
          <div className="executive-desk"><div className="wide-monitor"><i /></div><i className="laptop" /><i className="coffee" /><span>CODEX</span></div>
          <div className="workstation ws-left"><div className="monitor"><i /></div><div className="chair" /></div>
          <div className="workstation ws-right"><div className="monitor"><i /></div><div className="chair" /></div>
          <div className="agent-desk desk-review"><div className="monitor"><i /></div><div className="desk-chair" /><span>REVIEWER</span></div>
          <div className="agent-desk desk-test"><div className="monitor"><i /></div><div className="desk-chair" /><span>SORA</span></div>
          <div className="office-sofa"><i /><i /><span /></div>
          <div className="office-plant plant-left"><i /><b /></div><div className="office-plant plant-right"><i /><b /></div>
          <div className="server-rack"><i /><i /><i /><b /></div>
          <div className="kanban"><b>ROADMAP</b><i /><i /><i /><i /><i /></div>
          <div className="water-cooler"><i /><b /></div>
          <div className={`auto-door ${doorOpen ? "open" : ""}`}><div className="door-sign">AUTO · ENTRANCE</div><i className="door-left" /><i className="door-right" /><b className="door-sensor" /></div>
          {entering && <div className="entry-caption">WELCOME TO CODEX & CO.</div>}

          {staff.map((person) => <BusinessCharacter key={person.name} person={person} />)}

          <div className={`business-player image-player face-${player.facing} ${entering ? "entering" : ""}`} style={{ left: `${player.x}%`, top: `${player.y}%` }}>
            <div className="player-arrow">YOU ▼</div><div className="player-art" />
          </div>

          {nearCodex && !chatOpen && <button className="talk-prompt" onClick={talk}><kbd>ENTER</kbd><span>上司Codexに話しかける</span></button>}

          <div className="movement-pad">
            <button onClick={() => move(0,-2.6,"up")}>▲</button><button onClick={() => move(-2.2,0,"left")}>◀</button><button className={nearCodex ? "can-talk" : ""} onClick={talk}>A</button><button onClick={() => move(2.2,0,"right")}>▶</button><button onClick={() => move(0,2.6,"down")}>▼</button>
          </div>

          <div className="agent-strip">{staff.map((person) => <div key={person.name}><i style={{ background: person.suit }} /><span><b>{person.name}</b><small>{person.role}</small></span><em>{person.state}</em></div>)}</div>
        </div>

        <div className="control-hint"><span><kbd>WASD</kbd> / <kbd>矢印</kbd> 移動</span><span><kbd>ENTER</kbd> 会話</span><span>家具と社員には当たり判定があります</span></div>
      </section>

      <aside className="dev-monitor" aria-label="エージェント実行モニター">
        <header><div><i className="live-dot" /><b>LIVE DEV MONITOR</b></div><span>接続中</span></header>
        <section className="source-window">
          <div className="window-bar"><span>SOURCE CODE</span><div><i /><i /><i /></div></div>
          <div className="file-tabs"><button className="active"><i>TSX</i> OfficeDashboard.tsx</button><button><i>CSS</i> globals.css</button></div>
          <div className="code-breadcrumb">app <b>›</b> OfficeDashboard.tsx</div>
          <pre className="code-view"><code>{sourceLines.map((line, index) => {
            const activeLine = 2 + (runtimeTick % 14);
            return <span className={index === activeLine ? "active-line" : ""} key={index}><em>{String(index + 1).padStart(2, "0")}</em><b>{line || " "}</b>{index === activeLine && <i className="code-cursor" />}</span>;
          })}</code></pre>
          <div className="code-status"><span>Ln {3 + (runtimeTick % 14)}, Col 18</span><span>UTF-8</span><span>TypeScript React</span></div>
        </section>

        <section className="runtime-window">
          <div className="window-bar"><span>RUNNING</span><div className="running-badge"><i />LIVE</div></div>
          <div className="runtime-summary"><div><small>PROCESS</small><b>codex-agent</b></div><div><small>ELAPSED</small><b>04:{String(12 + runtimeTick).padStart(2,"0")}</b></div><div><small>CPU</small><b>{18 + runtimeTick % 9}%</b></div></div>
          <div className="terminal-output">{terminal.map((line, index) => <div className={index === terminal.length - 1 ? "latest" : ""} key={`${line}-${index}`}><span>{line.startsWith("$") ? "❯" : line.includes("EDIT") ? "+" : line.includes("TEST") ? "◆" : "·"}</span><code>{line.replace(/^\$ /, "")}</code></div>)}</div>
          <div className="terminal-command"><span>❯</span><code>npm run dev</code><i /></div>
        </section>

        <section className="agent-now"><div className="agent-now-head"><span>ACTIVE AGENTS</span><b>4 / 5</b></div>{staff.slice(0,4).map((person,index)=><div key={person.name}><i style={{background:person.suit}} /><span><b>{person.name}</b><small>{runtimeEvents[index][2]}</small></span><em className={index === runtimeTick % 4 ? "working" : ""}>{index === runtimeTick % 4 ? "RUN" : "LIVE"}</em></div>)}</section>
      </aside>

      {chatOpen && <div className="chat-backdrop" role="presentation">
        <section className="boss-chat" role="dialog" aria-modal="true" aria-label="上司Codexとのチャット">
          <header><div className="chat-portrait image-portrait" /><div><small>MANAGER CHANNEL</small><h2>上司 Codex</h2><span><i />オンライン · 指揮中</span></div><button onClick={() => setChatOpen(false)} aria-label="チャットを閉じる">×</button></header>
          <div className="chat-log">{messages.map((message, index) => <div className={`chat-message ${message.from}`} key={`${message.from}-${index}`}><b>{message.from === "codex" ? "Codex" : "あなた"}</b><p>{message.text}</p></div>)}</div>
          <form onSubmit={submitChat}><input ref={inputRef} value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Codexへの指示を入力…" aria-label="Codexへのメッセージ" /><button type="submit">送る ↗</button></form>
          <footer><span>ESCで閉じる</span><span>会話内容はタスク指示として扱われます</span></footer>
        </section>
      </div>}

      {toast && <div className="office-toast">！ {toast}</div>}
    </main>
  );
}
