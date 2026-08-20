/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// DIAG-2 — SHELL-level dev-gated runtime collector (graduated from electron/timetracker/diag.ts).
// Active ONLY when env DIAG=1. Started ONCE from CRM's main app.whenReady, so it runs regardless
// of which module is active. Additive + reversible: delete this file + the initDiag() call in
// main.ts + the `diag` block in preload.ts/types.ts + the renderer src/diag.ts hooks to remove.
// Guardrail (must not become the bug it hunts): fixed 2000ms cadence (NOT the 1s ticker),
// append-only JSONL, exactly ONE setInterval, never touches the timer/ticker/engine.
//
// HONEST-READ NOTE: procs[].cpu is REAL measured per-PROCESS %CPU. perModule{} is renderer
// ACTIVITY only (render counts / state-set counts / a live subscription snapshot) — it is NOT
// per-module CPU. Use procs[] to attribute CPU to a process, perModule{} to attribute renderer
// churn to a surface.
import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getMainWindow } from "./core/windows";

const SAMPLE_MS = 2000; // deliberately NOT 1000 (must not shadow the engine ticker)
const CPU_FLAG_PCT = 25;
const CPU_FLAG_STREAK = 3;

type ModuleBucket = { renders: number; stateSets: number; subs: number };
let lastPerModule: Record<string, ModuleBucket> = {};
let highCpuStreak = 0;

// Sum of webContents listener counts on the main window — grows if a listener leaks.
function wcListeners(): number {
  let n = 0;
  const wc = getMainWindow()?.webContents;
  if (wc) for (const name of wc.eventNames()) n += wc.listenerCount(name);
  return n;
}

export function initDiag(): void {
  if (process.env.DIAG !== "1") return; // hard gate — nothing below runs when unset

  const dir = path.join(app.getPath("userData"), "diag");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `diag-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const write = (obj: object) => fs.appendFileSync(file, JSON.stringify(obj) + "\n");

  // Single renderer -> main diag channel: the shell reporter ships a perModule map every 2s.
  ipcMain.on("diag:perModule", (_e, m: Record<string, ModuleBucket>) => {
    if (m && typeof m === "object") lastPerModule = m;
  });
  // NO "diag:enabled" HANDLER HERE (08-20-2026). ipc.ts:297 already registers one, unconditionally
  // and with the honest answer (`process.env.DIAG === "1"`). This file's copy only registered when
  // DIAG=1 and always returned a constant true — so the two coexisted fine with DIAG unset and
  // collided the moment the flag was on: "Attempted to register a second handler for
  // 'diag:enabled'", thrown out of initDiag as an unhandled rejection. The one mode this file
  // exists to serve was the only mode it broke. The renderer is unaffected either way — it invokes
  // the same channel and ipc.ts answers it.

  write({
    type: "session_start",
    ts: Date.now(),
    file,
    sampleMs: SAMPLE_MS,
    note: "procs[].cpu = real per-PROCESS %CPU; perModule{} = renderer ACTIVITY only (renders/stateSets/subs), NOT per-module CPU.",
  });

  // THE one added main interval.
  setInterval(() => {
    const procs = app.getAppMetrics().map((m) => ({
      pid: m.pid,
      type: m.type, // Browser | Renderer/Tab | GPU | Utility | ...
      cpu: Math.round((m.cpu?.percentCPUUsage ?? 0) * 10) / 10,
      wsKB: m.memory?.workingSetSize ?? 0,
    }));
    const ourCpu = Math.round(procs.reduce((a, p) => a + p.cpu, 0) * 10) / 10;
    const top3 = [...procs].sort((a, b) => b.cpu - a.cpu).slice(0, 3).map((p) => ({ type: p.type, cpu: p.cpu }));
    const renders = Object.values(lastPerModule).reduce((a, b) => a + (b.renders || 0), 0);
    const stateSets = Object.values(lastPerModule).reduce((a, b) => a + (b.stateSets || 0), 0);

    write({
      type: "sample",
      ts: Date.now(),
      ourCpu,
      mainRssKB: Math.round(process.memoryUsage().rss / 1024),
      rendersPerSample: renders, // top-level = sum across modules (back-compat with DIAG-1)
      tickStateSets: stateSets,
      wcListeners: wcListeners(),
      perModule: lastPerModule, // per-surface renderer activity (NOT cpu)
      procs,
    });

    // "Fan kicked in — which process?" marker.
    if (ourCpu >= CPU_FLAG_PCT) {
      if (++highCpuStreak >= CPU_FLAG_STREAK) {
        write({ type: "sustained_high_cpu", ts: Date.now(), ourCpu, totalCpuTop3: top3, note: "our-process %CPU breakdown" });
      }
    } else {
      highCpuStreak = 0;
    }
  }, SAMPLE_MS);

  console.log(`[DIAG] shell sampler @${SAMPLE_MS}ms -> ${file}`);
}
