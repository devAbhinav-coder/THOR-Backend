#!/usr/bin/env node
/**
 * Run API + worker together for local dev (Redis + SMTP + Razorpay from .env).
 * Usage: npm run dev:stack
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

const children = [];

function run(label, script) {
  const child = spawn(npm, ["run", script], {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[${label}] stopped (${signal})`);
    } else if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });
  children.push({ label, child });
  return child;
}

function shutdown(code = 0) {
  for (const { label, child } of children) {
    if (!child.killed) {
      console.log(`Stopping ${label}...`);
      if (isWin) {
        spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
          stdio: "ignore",
          shell: true,
        });
      } else {
        child.kill("SIGTERM");
      }
    }
  }
  setTimeout(() => process.exit(code), 500);
}

console.log("Starting House of Rani dev stack (API + worker)...");
console.log("Ensure Redis is running: npm run redis:up");
console.log("Press Ctrl+C to stop both processes.\n");

run("worker", "worker:dev");
setTimeout(() => run("api", "dev"), 1500);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
