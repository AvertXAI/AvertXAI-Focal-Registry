/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// dev:reset — a TRUE WIPE for repeated First-Run testing (Jason ruled: nothing in here he can't
// regenerate). DELETES both the userData folder (holds platform_registry + every org DB, in Roaming)
// AND the app-managed Markdown root (home\AvertXAI — after the storage relocation it lives OUTSIDE
// userData and would otherwise survive). Two guards only: never in a packaged app, never while the
// app is running. Prints one line per target so the result is never ambiguous.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// GUARD 1 — never in a packaged app. A plain `node` script cannot read Electron's app.isPackaged, and
// this script is NOT shipped inside the asar, so a packaged app is already incapable of running it.
// The runtime equivalent: refuse unless we are in the Focal Registry SOURCE repo.
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
} catch {
  pkg = null;
}
if (!pkg || pkg.name !== "avertxai-focal-registry") {
  console.error("dev:reset REFUSED — not the Focal Registry source repo. A packaged app must never run this.");
  process.exit(1);
}

// GUARD 2 — refuse if the app is running, and NAME which. Deleting under an open SQLite handle gives a
// corrupt file, not a clean slate.
const running = [];
try {
  const out = (spawnSync("tasklist", { encoding: "utf8", windowsHide: true }).stdout || "").toLowerCase();
  for (const name of ["electron.exe", "AvertXAI Focal Registry.exe"]) {
    if (out.includes(name.toLowerCase())) running.push(name);
  }
} catch {
  /* tasklist unavailable — rmSync fails loudly if a handle is actually open */
}
if (running.length) {
  console.error(`dev:reset REFUSED — running: ${running.join(", ")}. Close them first, then re-run.`);
  process.exit(1);
}

if (!process.env.APPDATA) {
  console.error("dev:reset: APPDATA is not set — cannot resolve the userData folder.");
  process.exit(1);
}
const productName = pkg.productName || "AvertXAI Focal Registry";
const targets = [
  { label: "userData     ", dir: path.join(process.env.APPDATA, productName) }, // Roaming — registry + all org DBs
  { label: "markdown root", dir: path.join(os.homedir(), "AvertXAI") },         // home\AvertXAI — the app-managed tree
];

for (const t of targets) {
  if (fs.existsSync(t.dir)) {
    fs.rmSync(t.dir, { recursive: true, force: true });
    console.log(`deleted    ${t.label}  ${t.dir}`);
  } else {
    console.log(`not found  ${t.label}  ${t.dir}`);
  }
}
console.log("dev:reset: done — the next boot runs First-Run from a true blank slate.");
