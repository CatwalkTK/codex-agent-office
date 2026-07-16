"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const BRIDGE = "http://127.0.0.1:4312";

type Props = {
  workspace?: string;
  connected?: boolean;
  projects?: ProjectSummary[];
  bridgeToken?: string;
  onWorkspaceChanged?: (workspace: string, projects?: ProjectSummary[]) => void;
  pool?: { maxAgents: number; activeAgents: number; queuedTasks: number };
  onAgentCountChanged?: (maxAgents: number) => void;
};

type ProjectSummary = { id: string; name: string; path: string; state: string; progress: number; currentTool?: string | null };

function authHeaders(token?: string, json = false) {
  const saved = token || (typeof window !== "undefined" ? window.sessionStorage.getItem("codex-office-bridge-token") || "" : "");
  return { ...(json ? { "Content-Type": "application/json" } : {}), ...(saved ? { Authorization: `Bearer ${saved}` } : {}) };
}

export function WorkspacePicker({ workspace: externalWorkspace, connected: externalConnected, projects: externalProjects, bridgeToken, onWorkspaceChanged, pool, onAgentCountChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [internalWorkspace, setInternalWorkspace] = useState(externalWorkspace || "");
  const [internalConnected, setInternalConnected] = useState(Boolean(externalConnected));
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState<"existing" | "multiple" | "new" | null>(null);
  const [message, setMessage] = useState("");
  const [internalProjects, setInternalProjects] = useState<ProjectSummary[]>(externalProjects || []);
  const [agentCount, setAgentCount] = useState(pool?.maxAgents || 10);
  const [agentBusy, setAgentBusy] = useState(false);
  const workspace = externalWorkspace ?? internalWorkspace;
  const connected = externalConnected ?? internalConnected;
  const projects = externalProjects ?? internalProjects;

  useEffect(() => {
    if (externalWorkspace !== undefined) return;
    fetch(`${BRIDGE}/snapshot`, { headers:authHeaders(bridgeToken) }).then((response) => response.json()).then((data) => {
      setInternalWorkspace(data.workspace || ""); setInternalConnected(Boolean(data.connected)); setInternalProjects(data.projects || []);
    }).catch(() => setInternalConnected(false));
  }, [externalWorkspace, bridgeToken]);

  const folderLabel = useMemo(() => {
    const active = projects.find((project)=>project.path===workspace || project.id===workspace);
    if (active?.name) return active.name;
    const clean = workspace.replace(/\/$/, "");
    return clean.split("/").pop() || "プロジェクト未選択";
  }, [workspace, projects]);

  async function select(mode: "existing" | "multiple" | "new") {
    if (mode === "new" && !folderName.trim()) { setMessage("新しいフォルダー名を入力してください"); return; }
    setBusy(mode); setMessage(mode === "multiple" ? "追加するプロジェクトを複数選択してください…" : mode === "existing" ? "フォルダー選択画面を開いています…" : "作成場所を選択してください…");
    try {
      const response = await fetch(`${BRIDGE}/workspace`, {
        method: "POST", headers: authHeaders(bridgeToken, true),
        body: JSON.stringify({ mode, name: mode === "new" ? folderName.trim() : undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "作業フォルダーを変更できませんでした");
      setInternalWorkspace(result.workspace); setInternalConnected(true); setFolderName(""); setInternalProjects(result.snapshot?.projects || projects);
      setMessage(mode === "multiple" ? `${result.snapshot?.projects?.length || projects.length}件のプロジェクトを登録しました` : "作業フォルダーを切り替えました"); onWorkspaceChanged?.(result.workspace, result.snapshot?.projects);
      window.setTimeout(() => setOpen(false), 650);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bridgeに接続できません"); }
    finally { setBusy(null); }
  }

  function createFolder(event: FormEvent) { event.preventDefault(); void select("new"); }

  async function activate(path: string) {
    if (path === workspace || busy) return;
    setBusy("existing"); setMessage("プロジェクトを切り替えています…");
    try {
      const response = await fetch(`${BRIDGE}/workspace/activate`, { method:"POST", headers:authHeaders(bridgeToken, true), body:JSON.stringify({ path }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "切り替えられませんでした");
      setInternalWorkspace(result.workspace); setInternalProjects(result.snapshot?.projects || projects); setMessage("表示プロジェクトを切り替えました"); onWorkspaceChanged?.(result.workspace, result.snapshot?.projects);
    } catch (error) { setMessage(error instanceof Error ? error.message : "切り替えエラー"); }
    finally { setBusy(null); }
  }

  async function saveAgentCount() {
    setAgentBusy(true); setMessage("エージェント数の変更をMacで確認してください…");
    try {
      const response = await fetch(`${BRIDGE}/settings/agents`, { method:"POST", headers:authHeaders(bridgeToken, true), body:JSON.stringify({ maxAgents:agentCount }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "エージェント数を変更できませんでした");
      const saved = result.pool?.maxAgents || agentCount; setAgentCount(saved); onAgentCountChanged?.(saved); setMessage(`エージェントプールを${saved}人に変更しました`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "設定エラー"); }
    finally { setAgentBusy(false); }
  }

  return <div className="workspace-picker">
    <button className="workspace-trigger" type="button" onClick={() => { setAgentCount(pool?.maxAgents||10); setOpen(true); setMessage(""); }} aria-haspopup="dialog">
      <span>PROJECTS · {projects.length} · ADD / SWITCH</span><b>▣ {folderLabel}</b><i className={connected && workspace ? "connected" : ""} />
    </button>
    {open && <div className="workspace-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-title">
        <header><div><small>MULTI-PROJECT SANDBOX</small><h2 id="workspace-title">複数プロジェクトを管理</h2></div><button type="button" disabled={Boolean(busy)} onClick={() => setOpen(false)} aria-label="閉じる">×</button></header>
        <div className="workspace-protection"><b>Officeシステムは保護されています</b><span>ここで選ぶフォルダーは、このUI本体とは別のプロジェクトです。Office本体やその配下は選択できません。</span></div>
        <div className="workspace-current"><span>現在の外部プロジェクト</span><code title={workspace}>{workspace ? folderLabel : "外部プロジェクト未選択"}</code></div>
        <div className="agent-pool-settings">
          <div><span>REAL AGENT POOL</span><b>{pool?.activeAgents || 0} 稼働 / {agentCount} 人</b><small>5〜20人。空きエージェントはオフィス内を歩き、タスク受領時に担当デスクへ移動します。</small></div>
          <label><input type="range" min="5" max="20" step="1" value={agentCount} onChange={(event)=>setAgentCount(Number(event.target.value))} disabled={!connected||agentBusy}/><strong>{agentCount}</strong></label>
          <button type="button" onClick={()=>void saveAgentCount()} disabled={!connected||agentBusy||agentCount===pool?.maxAgents}>{agentBusy?"確認中…":"人数を保存"}</button>
          <p>同時実行数を増やすとCodex利用量とPC負荷も増えます。同一Gitプロジェクトの並列作業はworktreeへ隔離します。</p>
        </div>
        {projects.length>0&&<div className="registered-projects"><span>登録済み {projects.length}件 · 切替中も他プロジェクトのタスクは継続</span>{projects.map((project)=><button type="button" key={project.path} className={project.path===workspace?"active":""} disabled={Boolean(busy)} onClick={()=>void activate(project.path)}><i className={`project-dot ${project.state}`}/><b>{project.name}</b><small>{project.state==="working"||project.state==="starting"?`${project.progress}% · ${project.currentTool||"処理中"}`:project.state}</small><em>{project.path===workspace?"表示中":"切替"}</em></button>)}</div>}
        <button className="workspace-existing workspace-multiple" type="button" disabled={Boolean(busy) || !connected} onClick={() => void select("multiple")}><i>＋</i><span><b>複数の既存プロジェクトを一括追加</b><small>選択画面で複数フォルダーを選べます。登録済みの処理は止まりません。</small></span><em>MULTI SELECT</em></button>
        <div className="workspace-divider"><span>または</span></div>
        <form onSubmit={createFolder}><label htmlFor="new-workspace-name">新規プロジェクト・サンドボックス</label><div><input id="new-workspace-name" value={folderName} onChange={(event)=>setFolderName(event.target.value)} placeholder="プロジェクト名を入力" disabled={Boolean(busy)} autoComplete="off"/><button type="submit" disabled={Boolean(busy) || !connected || !folderName.trim()}>作成場所を選ぶ</button></div><small>Office外に新しいフォルダーを作成し、その中だけを書き込み可能にします。</small></form>
        {message && <p className={`workspace-message ${busy ? "busy" : ""}`}>{busy && <i />}{message}</p>}
        {!connected && <p className="workspace-error">Bridgeが未接続です。先に npm run bridge を起動してください。</p>}
      </section>
    </div>}
  </div>;
}
