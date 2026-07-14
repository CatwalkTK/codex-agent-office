"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspacePicker } from "./WorkspacePicker";

type Tetromino = "I" | "J" | "L" | "O" | "S" | "T" | "Z";
type Phase = "ready" | "playing" | "paused" | "gameover";
type Cell = Tetromino | null;
type Board = Cell[][];
type Piece = { type: Tetromino; rotation: number; x: number; y: number };
type Game = {
  board: Board;
  piece: Piece;
  next: Tetromino[];
  hold: Tetromino | null;
  canHold: boolean;
  score: number;
  lines: number;
  level: number;
  phase: Phase;
};

const COLS = 10;
const ROWS = 20;
const TYPES: Tetromino[] = ["I", "J", "L", "O", "S", "T", "Z"];
const SHAPES: Record<Tetromino, number[][][]> = {
  I: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
  ],
  J: [
    [[1,0,0],[1,1,1],[0,0,0]], [[0,1,1],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,0,1]], [[0,1,0],[0,1,0],[1,1,0]],
  ],
  L: [
    [[0,0,1],[1,1,1],[0,0,0]], [[0,1,0],[0,1,0],[0,1,1]],
    [[0,0,0],[1,1,1],[1,0,0]], [[1,1,0],[0,1,0],[0,1,0]],
  ],
  O: Array(4).fill([[1,1],[1,1]]),
  S: [
    [[0,1,1],[1,1,0],[0,0,0]], [[0,1,0],[0,1,1],[0,0,1]],
    [[0,0,0],[0,1,1],[1,1,0]], [[1,0,0],[1,1,0],[0,1,0]],
  ],
  T: [
    [[0,1,0],[1,1,1],[0,0,0]], [[0,1,0],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]], [[0,1,0],[1,1,0],[0,1,0]],
  ],
  Z: [
    [[1,1,0],[0,1,1],[0,0,0]], [[0,0,1],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,0],[0,1,1]], [[0,1,0],[1,1,0],[1,0,0]],
  ],
};

const emptyBoard = (): Board => Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
const shuffledBag = () => [...TYPES].sort(() => Math.random() - 0.5);
const spawn = (type: Tetromino): Piece => ({ type, rotation: 0, x: type === "O" ? 4 : 3, y: -1 });

function cells(piece: Piece) {
  const shape = SHAPES[piece.type][piece.rotation];
  const result: { x: number; y: number }[] = [];
  shape.forEach((row, y) => row.forEach((value, x) => value && result.push({ x: piece.x + x, y: piece.y + y })));
  return result;
}

function collides(board: Board, piece: Piece) {
  return cells(piece).some(({ x, y }) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x]));
}

function freshGame(): Game {
  const queue = [...shuffledBag(), ...shuffledBag()];
  return { board: emptyBoard(), piece: spawn(queue.shift()!), next: queue, hold: null, canHold: true, score: 0, lines: 0, level: 1, phase: "ready" };
}

function initialGame(): Game {
  const queue = [...TYPES, ...TYPES];
  return { board: emptyBoard(), piece: spawn(queue.shift()!), next: queue, hold: null, canHold: true, score: 0, lines: 0, level: 1, phase: "ready" };
}

function MiniPiece({ type }: { type: Tetromino | null }) {
  if (!type) return <div className="mini-empty">—</div>;
  const shape = SHAPES[type][0];
  return <div className={`mini-piece mini-${type}`} style={{ gridTemplateColumns: `repeat(${shape[0].length}, 1fr)` }}>
    {shape.flat().map((value, i) => <i key={i} className={value ? "on" : ""} />)}
  </div>;
}

export function TetrisGame() {
  // The server and browser must render the exact same first board. Randomness
  // starts only after the player presses START.
  const [game, setGame] = useState<Game>(initialGame);
  const gameRef = useRef<Game>(game);
  const [best, setBest] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const audioRef = useRef<AudioContext | null>(null);

  const sync = useCallback((next: Game) => {
    gameRef.current = next;
    setGame({ ...next, board: next.board.map(row => [...row]), next: [...next.next] });
  }, []);

  const tone = useCallback((frequency: number, duration = 0.045) => {
    if (!soundOn) return;
    try {
      const ctx = audioRef.current ?? new AudioContext();
      audioRef.current = ctx;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + duration);
    } catch { /* Audio is an optional enhancement. */ }
  }, [soundOn]);

  const fillQueue = (queue: Tetromino[]) => {
    const next = [...queue];
    if (next.length < 7) next.push(...shuffledBag());
    return next;
  };

  const finishIfBlocked = useCallback((next: Game) => {
    if (!collides(next.board, next.piece)) return next;
    const high = Math.max(next.score, Number(localStorage.getItem("neon-tetris-best") || 0));
    localStorage.setItem("neon-tetris-best", String(high));
    setBest(high);
    return { ...next, phase: "gameover" as Phase };
  }, []);

  const lockPiece = useCallback((source: Game) => {
    const board = source.board.map(row => [...row]);
    let aboveTop = false;
    cells(source.piece).forEach(({ x, y }) => { if (y < 0) aboveTop = true; else board[y][x] = source.piece.type; });
    const remaining = board.filter(row => row.some(cell => !cell));
    const cleared = ROWS - remaining.length;
    while (remaining.length < ROWS) remaining.unshift(Array<Cell>(COLS).fill(null));
    const points = [0, 100, 300, 500, 800][cleared] * source.level;
    const lines = source.lines + cleared;
    const queue = fillQueue(source.next);
    const piece = spawn(queue.shift()!);
    let next: Game = { ...source, board: remaining, piece, next: queue, canHold: true, score: source.score + points, lines, level: Math.floor(lines / 10) + 1 };
    if (aboveTop) {
      const high = Math.max(next.score, Number(localStorage.getItem("neon-tetris-best") || 0));
      localStorage.setItem("neon-tetris-best", String(high));
      setBest(high);
      next = { ...next, phase: "gameover" };
    }
    if (cleared) tone(cleared === 4 ? 880 : 520 + cleared * 70, cleared === 4 ? 0.18 : 0.09);
    else tone(110);
    return finishIfBlocked(next);
  }, [finishIfBlocked, tone]);

  const move = useCallback((dx: number, dy: number, soft = false) => {
    const current = gameRef.current;
    if (current.phase !== "playing") return false;
    const moved = { ...current.piece, x: current.piece.x + dx, y: current.piece.y + dy };
    if (!collides(current.board, moved)) {
      sync({ ...current, piece: moved, score: current.score + (soft && dy > 0 ? 1 : 0) });
      if (dx) tone(165);
      return true;
    }
    if (dy > 0) sync(lockPiece(current));
    return false;
  }, [lockPiece, sync, tone]);

  const rotate = useCallback(() => {
    const current = gameRef.current;
    if (current.phase !== "playing") return;
    const rotated = { ...current.piece, rotation: (current.piece.rotation + 1) % 4 };
    for (const kick of [0, -1, 1, -2, 2]) {
      const candidate = { ...rotated, x: rotated.x + kick };
      if (!collides(current.board, candidate)) { sync({ ...current, piece: candidate }); tone(260); return; }
    }
  }, [sync, tone]);

  const hardDrop = useCallback(() => {
    const current = gameRef.current;
    if (current.phase !== "playing") return;
    let piece = current.piece;
    let distance = 0;
    while (!collides(current.board, { ...piece, y: piece.y + 1 })) { piece = { ...piece, y: piece.y + 1 }; distance++; }
    sync(lockPiece({ ...current, piece, score: current.score + distance * 2 }));
    tone(90, 0.08);
  }, [lockPiece, sync, tone]);

  const hold = useCallback(() => {
    const current = gameRef.current;
    if (current.phase !== "playing" || !current.canHold) return;
    const queue = fillQueue(current.next);
    const incoming = current.hold ?? queue.shift()!;
    sync(finishIfBlocked({ ...current, piece: spawn(incoming), next: queue, hold: current.piece.type, canHold: false }));
    tone(330);
  }, [finishIfBlocked, sync, tone]);

  const start = useCallback(() => {
    const next = freshGame(); next.phase = "playing"; sync(next);
    if (audioRef.current?.state === "suspended") audioRef.current.resume();
  }, [sync]);

  const pause = useCallback(() => {
    const current = gameRef.current;
    if (current.phase !== "playing" && current.phase !== "paused") return;
    sync({ ...current, phase: current.phase === "paused" ? "playing" : "paused" });
  }, [sync]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setBest(Number(localStorage.getItem("neon-tetris-best") || 0)));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (game.phase !== "playing") return;
    const speed = Math.max(90, 850 - (game.level - 1) * 70);
    const timer = window.setInterval(() => move(0, 1), speed);
    return () => window.clearInterval(timer);
  }, [game.level, game.phase, move]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (["arrowleft","arrowright","arrowdown","arrowup"," ","c","p","enter"].includes(key)) event.preventDefault();
      if (event.repeat && ["arrowup"," ","c","p","enter"].includes(key)) return;
      if (key === "arrowleft") move(-1, 0);
      else if (key === "arrowright") move(1, 0);
      else if (key === "arrowdown") move(0, 1, true);
      else if (key === "arrowup" || key === "x") rotate();
      else if (key === " ") hardDrop();
      else if (key === "c") hold();
      else if (key === "p") pause();
      else if (key === "enter" && ["ready", "gameover"].includes(gameRef.current.phase)) start();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [hardDrop, hold, move, pause, rotate, start]);

  let ghost = game.piece;
  if (game.phase === "playing") while (!collides(game.board, { ...ghost, y: ghost.y + 1 })) ghost = { ...ghost, y: ghost.y + 1 };
  const active = new Map(cells(game.piece).map(cell => [`${cell.x}:${cell.y}`, game.piece.type]));
  const ghostCells = new Set(cells(ghost).map(cell => `${cell.x}:${cell.y}`));
  const display = game.board.map((row, y) => row.map((cell, x) => ({ cell: active.get(`${x}:${y}`) ?? cell, ghost: !cell && !active.has(`${x}:${y}`) && ghostCells.has(`${x}:${y}`) })));

  return <main className="tetris-shell">
    <section className="tetris-app" aria-label="NEON TETRIS ゲーム">
      <header className="game-header">
        <div><p className="kicker">ARCADE SYSTEM // 1989</p><h1>NEON <span>TETRIS</span></h1></div>
        <div className="game-header-tools"><WorkspacePicker/><div className="live-indicator"><i /> SYSTEM ONLINE</div></div>
      </header>

      <aside className="left-rail">
        <section className="panel hold-panel"><h2>HOLD</h2><MiniPiece type={game.hold} /></section>
        <section className="panel score-panel"><h2>SCORE</h2><strong>{game.score.toString().padStart(7, "0")}</strong></section>
        <section className="panel stat-grid"><div><span>LEVEL</span><b>{String(game.level).padStart(2, "0")}</b></div><div><span>LINES</span><b>{String(game.lines).padStart(3, "0")}</b></div></section>
        <section className="panel best-panel"><h2>HIGH SCORE</h2><strong>{best.toString().padStart(7, "0")}</strong></section>
      </aside>

      <div className="board-frame">
        <div className="board" role="img" aria-label={`テトリス盤面。スコア${game.score}、消したライン${game.lines}`}>
          {display.flatMap((row, y) => row.map(({ cell, ghost: isGhost }, x) => <i key={`${x}-${y}`} className={`cell ${cell ? `piece-${cell}` : ""} ${isGhost ? `ghost piece-${game.piece.type}` : ""}`} />))}
        </div>
        {game.phase !== "playing" && <div className="game-overlay">
          <div><p>{game.phase === "paused" ? "BREAK TIME" : game.phase === "gameover" ? "STACK OVERFLOW" : "READY PLAYER ONE"}</p>
          <h2>{game.phase === "paused" ? "PAUSED" : game.phase === "gameover" ? "GAME OVER" : "積み上げろ。"}</h2>
          {game.phase !== "paused" && <span>{game.phase === "gameover" ? `SCORE ${game.score.toLocaleString("ja-JP")}` : "ラインを揃えて、ハイスコアを更新しよう。"}</span>}
          <button onClick={game.phase === "paused" ? pause : start}>{game.phase === "paused" ? "▶ RESUME" : game.phase === "gameover" ? "↻ RETRY" : "▶ START GAME"}</button></div>
        </div>}
      </div>

      <aside className="right-rail">
        <section className="panel next-panel"><h2>NEXT</h2>{game.next.slice(0, 4).map((type, i) => <div className="next-item" key={`${type}-${i}`}><MiniPiece type={type} /></div>)}</section>
        <button className="utility" onClick={pause}>{game.phase === "paused" ? "▶ RESUME" : "Ⅱ PAUSE"}</button>
        <button className="utility" onClick={() => setSoundOn(value => !value)}>{soundOn ? "♪ SOUND ON" : "× SOUND OFF"}</button>
      </aside>

      <div className="touch-controls" aria-label="タッチ操作">
        <button onPointerDown={() => move(-1, 0)} aria-label="左へ移動">◀</button>
        <button onPointerDown={() => move(1, 0)} aria-label="右へ移動">▶</button>
        <button onPointerDown={() => rotate()} aria-label="回転">↻</button>
        <button onPointerDown={() => move(0, 1, true)} aria-label="下へ移動">▼</button>
        <button className="drop" onPointerDown={hardDrop} aria-label="一気に落とす">DROP</button>
      </div>

      <footer><span>← → MOVE</span><span>↑ ROTATE</span><span>↓ SOFT DROP</span><span>SPACE HARD DROP</span><span>C HOLD</span><span>P PAUSE</span></footer>
    </section>
  </main>;
}
