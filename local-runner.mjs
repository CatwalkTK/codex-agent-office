import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();
let stopping = false;

function start(label, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;

    stopping = true;
    for (const running of children) running.kill("SIGTERM");

    const reason = signal ? `signal ${signal}` : `exit ${code ?? 1}`;
    console.error(`${label} stopped (${reason})`);
    process.exitCode = code ?? 1;
  });

  return child;
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

start("Codex bridge", process.execPath, ["local-bridge.mjs"]);
start("Local site", npmCommand, ["run", "dev"]);
