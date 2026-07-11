"use client";

import { useEffect, useMemo, useState } from "react";

type Status = "coding" | "research" | "review" | "waiting" | "idle";

type Agent = {
  id: number;
  name: string;
  role: string;
  status: Status;
  task: string;
  detail: string;
  tool: string;
  context: number;
  x: number;
  y: number;
  color: string;
  accent: string;
  elapsed: string;
  parent?: string;
};

const initialAgents: Agent[] = [
  { id: 1, name: "Codex", role: "リードエージェント", status: "coding", task: "UIコンポーネントを実装中", detail: "app/OfficeDashboard.tsx を編集", tool: "apply_patch", context: 68, x: 34, y: 28, color: "#f0bc65", accent: "#6e55d7", elapsed: "04:12" },
  { id: 2, name: "Scout", role: "リサーチャー", status: "research", task: "リポジトリを調査中", detail: "関連ファイルと依存関係を検索", tool: "web.search", context: 41, x: 63, y: 25, color: "#e88575", accent: "#3f86c7", elapsed: "02:48", parent: "Codex" },
  { id: 3, name: "Mika", role: "フロントエンド", status: "coding", task: "レスポンシブ表示を調整", detail: "スタイルとレイアウトを確認", tool: "editor", context: 52, x: 76, y: 53, color: "#72b99d", accent: "#c66080", elapsed: "03:24", parent: "Codex" },
  { id: 4, name: "Reviewer", role: "コードレビュー", status: "review", task: "変更差分をレビュー中", detail: "アクセシビリティと型を検査", tool: "git diff", context: 34, x: 45, y: 67, color: "#8d9bd8", accent: "#cb8152", elapsed: "01:56", parent: "Codex" },
  { id: 5, name: "Sora", role: "テスト担当", status: "waiting", task: "確認を待っています", detail: "ビルド実行の承認待ち", tool: "terminal", context: 23, x: 16, y: 61, color: "#d58fc0", accent: "#4e8f76", elapsed: "00:38", parent: "Codex" },
];

const statusText: Record<Status, string> = {
  coding: "実装中",
  research: "調査中",
  review: "レビュー",
  waiting: "確認待ち",
  idle: "待機中",
};

const events = [
  ["14:32", "Codex", "ファイルを更新", "OfficeDashboard.tsx"],
  ["14:31", "Reviewer", "差分を確認", "+284 / −16"],
  ["14:30", "Scout", "参照先を発見", "pixel-agents"],
  ["14:28", "Mika", "スタイルを調整", "globals.css"],
];

function PixelPerson({ agent, selected }: { agent: Agent; selected: boolean }) {
  const busy = agent.status !== "idle" && agent.status !== "waiting";
  return (
    <div className={`agent ${agent.status} ${agent.id === 1 ? "boss" : ""} ${selected ? "selected" : ""}`} style={{ left: `${agent.x}%`, top: `${agent.y}%` }}>
      {agent.id === 1 && <div className="boss-title">★ 上司</div>}
      <div className="thought">{agent.status === "coding" ? "⌨" : agent.status === "research" ? "⌕" : agent.status === "review" ? "✓" : "!"}</div>
      <div className="person" style={{ "--shirt": agent.accent, "--skin": agent.color } as React.CSSProperties}>
        <i className="cape" /><i className="hair" /><i className="head" /><i className="body" /><i className="belt" /><i className="legs" />
      </div>
      <div className="agent-label"><span className={busy ? "pulse" : ""} />{agent.name}</div>
    </div>
  );
}

export function OfficeDashboard() {
  const [agents, setAgents] = useState(initialAgents);
  const [selectedId, setSelectedId] = useState(1);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [query, setQuery] = useState("");
  const [clock, setClock] = useState("14:32:18");
  const [toast, setToast] = useState("");
  const [player, setPlayer] = useState({ x: 34, y: 48, facing: "up" });
  const [dialogue, setDialogue] = useState(0);

  const dialogueLines = [
    "よく来た、Jobs1よ。いまエージェントたちは新しいUIを組み立てている。",
    "Scoutは情報を集め、Mikaは画面を整え、Reviewerは品質を守っているぞ。",
    "君の次の指示を聞かせてくれ。クエストとして仲間たちに届けよう！",
  ];

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (live) setClock(new Date().toLocaleTimeString("ja-JP", { hour12: false }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "enter", " "].includes(key)) event.preventDefault();
      if (key === "enter" || key === " ") {
        setDialogue((current) => (current + 1) % dialogueLines.length);
        return;
      }
      const moves: Record<string, { dx: number; dy: number; facing: string }> = {
        arrowup: { dx: 0, dy: -3, facing: "up" }, w: { dx: 0, dy: -3, facing: "up" },
        arrowdown: { dx: 0, dy: 3, facing: "down" }, s: { dx: 0, dy: 3, facing: "down" },
        arrowleft: { dx: -3, dy: 0, facing: "left" }, a: { dx: -3, dy: 0, facing: "left" },
        arrowright: { dx: 3, dy: 0, facing: "right" }, d: { dx: 3, dy: 0, facing: "right" },
      };
      const move = moves[key];
      if (move) setPlayer((current) => ({ x: Math.max(5, Math.min(94, current.x + move.dx)), y: Math.max(12, Math.min(88, current.y + move.dy)), facing: move.facing }));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogueLines.length]);

  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];
  const visible = useMemo(() => agents.filter((a) => (filter === "all" || a.status === filter) && a.name.toLowerCase().includes(query.toLowerCase())), [agents, filter, query]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function cycleStatus() {
    const order: Status[] = ["coding", "research", "review", "waiting", "idle"];
    setAgents((current) => current.map((a) => a.id === selected.id ? { ...a, status: order[(order.indexOf(a.status) + 1) % order.length] } : a));
    notify(`${selected.name} の状態を更新しました`);
  }

  function movePlayer(dx: number, dy: number, facing: string) {
    setPlayer((current) => ({ x: Math.max(5, Math.min(94, current.x + dx)), y: Math.max(12, Math.min(88, current.y + dy)), facing }));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">C</div><div><strong>CODEX OFFICE</strong><small>AGENT OPERATIONS</small></div></div>
        <div className="project"><span className="folder">▰</span><div><small>WORKSPACE</small><b>codex-visual-ui</b></div><span className="chevron">⌄</span></div>
        <div className="top-actions">
          <button className={`live-button ${live ? "on" : ""}`} onClick={() => setLive(!live)}><span />{live ? "LIVE" : "PAUSED"}</button>
          <button className="icon-button" aria-label="通知" onClick={() => notify("新しい通知はありません")}>♢<em>2</em></button>
          <div className="avatar">J</div>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-heading"><span>AGENTS</span><button onClick={() => notify("新規エージェントの追加画面を開きます")}>＋</button></div>
        <div className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="エージェントを検索" /></div>
        <div className="filters">
          {(["all", "coding", "waiting"] as const).map((item) => <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item === "all" ? `すべて ${agents.length}` : item === "coding" ? `稼働中 ${agents.filter(a => a.status === "coding").length}` : `確認待ち ${agents.filter(a => a.status === "waiting").length}`}</button>)}
        </div>
        <div className="agent-list">
          {visible.map((agent) => (
            <button key={agent.id} className={`agent-row ${selectedId === agent.id ? "active" : ""}`} onClick={() => setSelectedId(agent.id)}>
              <div className="mini-person" style={{ "--shirt": agent.accent, "--skin": agent.color } as React.CSSProperties}><i /><b /></div>
              <div className="agent-copy"><strong>{agent.name}</strong><span><i className={`dot ${agent.status}`} />{statusText[agent.status]}</span></div>
              <small>{agent.elapsed}</small>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom"><button onClick={() => notify("設定パネルを開きます")}>⚙ <span>オフィス設定</span></button><button onClick={() => notify("稼働レポートを作成します")}>▥ <span>稼働レポート</span></button></div>
      </aside>

      <section className="workspace">
        <div className="workspace-head">
          <div><div className="eyebrow">CODEX QUEST · LIVE WORKSPACE</div><h1>はじまりのオフィス</h1></div>
          <div className="workspace-actions"><span>{clock}</span><button onClick={() => notify("俯瞰表示に切り替えました")}>▦ 俯瞰</button><button onClick={() => notify("レイアウト編集モード")}>✦ レイアウト</button></div>
        </div>

        <div className="office-card">
          <div className="game-hud"><div><span>ゆうしゃ</span><b>Jobs1</b></div><div><span>LEVEL</span><b>12</b></div><div><span>MISSION</span><b>上司Codexに話しかける</b></div></div>
          <div className="office-grid">
            <div className="room-title planning">PLANNING</div><div className="room-title build">BUILD ZONE</div><div className="room-title review-room">REVIEW</div>
            <div className="rug rug-a" /><div className="rug rug-b" />
            <div className="plant p1"><i /><b /></div><div className="plant p2"><i /><b /></div>
            <div className="desk d1"><i className="screen" /><i className="keyboard" /></div>
            <div className="desk d2"><i className="screen" /><i className="keyboard" /></div>
            <div className="desk d3"><i className="screen" /><i className="keyboard" /></div>
            <div className="table"><i /><i /><i /></div>
            <div className="sofa"><i /><i /></div>
            <div className="whiteboard"><span>SPRINT 24</span><i /><i /><i /></div>
            <div className="server"><i /><i /><i /></div>
            {agents.map((agent) => <button className="agent-button" aria-label={`${agent.name}を選択`} key={agent.id} onClick={() => setSelectedId(agent.id)}><PixelPerson agent={agent} selected={selected.id === agent.id} /></button>)}
            <div className={`player-character face-${player.facing}`} style={{ left: `${player.x}%`, top: `${player.y}%` }}>
              <div className="player-name">▼ あなた</div><i className="player-hair" /><i className="player-head" /><i className="player-body" /><i className="player-sash" /><i className="player-legs" /><i className="player-sword" />
            </div>
            <div className="rpg-dialogue" role="dialog" aria-label="Codexとの会話" onClick={() => setDialogue((dialogue + 1) % dialogueLines.length)}>
              <div className="speaker-face"><i /><b /><em /></div>
              <div><strong>上司 Codex</strong><p>「{dialogueLines[dialogue]}」</p><small>Enter / Space またはクリックで次へ <span>▼</span></small></div>
            </div>
            <div className="game-controls" aria-label="キャラクター操作">
              <button aria-label="上へ" onClick={() => movePlayer(0,-3,"up")}>▲</button><button aria-label="左へ" onClick={() => movePlayer(-3,0,"left")}>◀</button><button aria-label="話す" className="talk" onClick={() => setDialogue((dialogue + 1) % dialogueLines.length)}>A</button><button aria-label="右へ" onClick={() => movePlayer(3,0,"right")}>▶</button><button aria-label="下へ" onClick={() => movePlayer(0,3,"down")}>▼</button>
            </div>
          </div>
          <div className="office-legend"><span><i className="dot coding" />稼働中</span><span><i className="dot research" />調査中</span><span><i className="dot waiting" />確認待ち</span><small>矢印キー / WASDで移動 · Enter / Spaceで話す</small></div>
        </div>

        <div className="activity-section">
          <div className="section-title"><div><span>ACTIVITY STREAM</span><h2>最近のアクティビティ</h2></div><button onClick={() => notify("すべての履歴を表示します")}>すべて表示 →</button></div>
          <div className="activity-list">{events.map((event, index) => <div className="event" key={event[0] + event[1]}><time>{event[0]}</time><span className={`event-icon e${index}`}>{index === 0 ? "⌘" : index === 1 ? "✓" : index === 2 ? "⌕" : "✦"}</span><p><b>{event[1]}</b> が{event[2]}</p><code>{event[3]}</code></div>)}</div>
        </div>
      </section>

      <aside className="detail-panel">
        <div className="detail-top"><span>AGENT DETAIL</span><button aria-label="詳細パネルを閉じる" onClick={() => notify("詳細パネルは常時表示です")}>×</button></div>
        <div className="profile"><div className="profile-person" style={{ "--shirt": selected.accent, "--skin": selected.color } as React.CSSProperties}><i /><b /><em /></div><h2>{selected.name}</h2><p>{selected.role}</p><span className={`status-pill ${selected.status}`}><i />{statusText[selected.status]}</span></div>
        <div className="task-card"><div className="task-head"><span>CURRENT TASK</span><small>{selected.elapsed}</small></div><h3>{selected.task}</h3><p>{selected.detail}</p><div className="tool"><span>⌘</span><div><small>使用中のツール</small><b>{selected.tool}</b></div><i className="typing">•••</i></div></div>
        <div className="context-block"><div><span>CONTEXT WINDOW</span><b>{selected.context}%</b></div><div className="meter"><i style={{ width: `${selected.context}%` }} /></div><small>{Math.round(selected.context * 2.56)}K / 256K tokens</small></div>
        <div className="detail-stats"><div><span>変更ファイル</span><b>7</b></div><div><span>ツール呼出</span><b>24</b></div><div><span>経過時間</span><b>{selected.elapsed}</b></div></div>
        <div className="lineage"><span>AGENT LINEAGE</span><div><div className="line-agent root">C</div><p><b>Codex</b><small>メインエージェント</small></p></div>{selected.parent && <div className="child"><i /><div className="line-agent">{selected.name[0]}</div><p><b>{selected.name}</b><small>{selected.role}</small></p></div>}</div>
        <div className="detail-actions"><button onClick={() => notify(`${selected.name} にメッセージを送ります`)}>↗ メッセージ</button><button onClick={cycleStatus}>状態を変更</button></div>
      </aside>
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}
