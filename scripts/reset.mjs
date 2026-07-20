/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// dev:reset — RENAMES the whole userData folder to a timestamped backup so the next boot runs First-Run
// from a TRUE blank slate. dev:clean only removed platform_registry (and from a legacy folder name), so
// the org database survived, the boot migration found it, and First-Run never reappeared. This NEVER
// deletes — it renames, so a mistake is one rename away from undone.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// GUARD 1 (FIRST) — dev-only. A plain `node` script cannot read Electron's app.isPackaged, so the
// equivalent guard is: this MUST run from the Focal Registry SOURCE repo. Refuse otherwise — this must
// never run against a packaged install's data.
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
} catch {
  pkg = null;
}
if (!pkg || pkg.name !== "avertxai-focal-registry") {
  console.error("dev:reset REFUSED — not the Focal Registry source repo. This is dev-only; never run it against a packaged install.");
  process.exit(1);
}

// GUARD 2 — refuse if the app is running, and NAME which. Renaming a folder that holds an open SQLite
// handle corrupts the database.
const running = [];
try {
  const out = (spawnSync("tasklist", { encoding: "utf8", windowsHide: true }).stdout || "").toLowerCase();
  for (const name of ["electron.exe", "AvertXAI Focal Registry.exe"]) {
    if (out.includes(name.toLowerCase())) running.push(name);
  }
} catch {
  /* tasklist unavailable — fall through; the rename fails loudly if a handle is actually open */
}
if (running.length) {
  console.error(`dev:reset REFUSED — running: ${running.join(", ")}. Close them first (an open SQLite handle would be corrupted by the rename).`);
  process.exit(1);
}

// userData folder derives from productName — NEVER hardcoded.
if (!process.env.APPDATA) {
  console.error("dev:reset: APPDATA is not set — cannot resolve the userData folder.");
  process.exit(1);
}
const productName = pkg.productName || "AvertXAI Focal Registry";
const userData = path.join(process.env.APPDATA, productName);
if (!fs.existsSync(userData)) {
  console.log(`dev:reset: nothing to reset — "${userData}" does not exist (already a blank slate).`);
  process.exit(0);
}

const d = new Date();
const p2 = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
const backup = `${userData}.backup-${stamp}`;

fs.renameSync(userData, backup); // NEVER delete
console.log("dev:reset: the next boot runs First-Run from a blank slate. Nothing was deleted.");
console.log(`  backed up to: ${backup}`);
console.log(`  to undo:      rename it back to "${productName}"`);
console.log("  note: the app-managed Markdown tree lives OUTSIDE userData (default %USERPROFILE%\\AvertXAI),");
console.log("        so it is NOT touched by this reset. Delete %USERPROFILE%\\AvertXAI by hand for a true blank slate.");
