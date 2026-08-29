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
//
// ⚠ TWO holes were closed here on 08-02-2026, EITHER of which let a live app walk straight past:
//   1. "Focal Registry.exe" — the packaged process name since the productName change — was not in
//      the list at all. Canon: the packaged process IS Focal Registry.exe; kill it AND electron.exe.
//   2. The default `tasklist` table CLIPS the Image Name column at 25 characters, and
//      "AvertXAI Focal Registry.exe" is 27 — so even the name that WAS listed could never match.
//      `/fo csv` returns the name whole, in a quoted field, which also makes the comparison exact:
//      `"focal registry.exe"` cannot match inside `"avertxai focal registry.exe"`.
// The old name is kept: harmless, and it still covers anyone running an older install.
const PROCESS_NAMES = ["electron.exe", "Focal Registry.exe", "AvertXAI Focal Registry.exe"];
const running = [];
try {
  let out = (spawnSync("tasklist", ["/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).stdout || "").toLowerCase();
  const exact = out !== "";
  // Fallback for a tasklist without CSV support: match the CLIPPED form the table would show,
  // rather than silently missing a long name.
  if (!exact) out = (spawnSync("tasklist", { encoding: "utf8", windowsHide: true }).stdout || "").toLowerCase();
  // Empty output is NOT "nothing is running" — it means the probe told us nothing. Treat it the
  // same as a throw (Jason ruled 08-02-2026: the guard REFUSES when it cannot verify).
  if (out === "") throw new Error("tasklist returned no output");
  for (const name of PROCESS_NAMES) {
    const n = name.toLowerCase();
    if (exact ? out.includes(`"${n}"`) : out.includes(n.slice(0, 25))) running.push(name);
  }
} catch (e) {
  // CANNOT VERIFY → REFUSE. The old behaviour swallowed this and deleted anyway, trusting rmSync to
  // fail on an open handle — but on Windows a delete under a live SQLite handle can PARTIALLY
  // succeed, which is the corrupt database this guard exists to prevent. An unverifiable check is a
  // failed check.
  console.error(
    `dev:reset REFUSED — could not check whether the app is running: ${e instanceof Error ? e.message : String(e)}`
  );
  console.error("NOTHING was deleted. Close Focal Registry and electron, then re-run.");
  process.exit(1);
}
if (running.length) {
  console.error(`dev:reset REFUSED — running: ${running.join(", ")}. Close them first, then re-run.`);
  process.exit(1);
}

if (!process.env.APPDATA) {
  console.error("dev:reset: APPDATA is not set — cannot resolve the userData folder.");
  process.exit(1);
}
// The fallback matched the PRE-rename product and so pointed at a userData folder that no longer
// exists; package.json always carries productName (GUARD 1 proved the file parsed), so this only
// ever mattered if that key were removed — but a wrong path here is a wrong deletion target.
const productName = pkg.productName || "Focal Registry";
// THE SANDBOX, NEVER THE REAL FOLDER (08-24-2026). main.ts routes every unpackaged run to
// "<productName> (dev)"; the plain "<productName>" folder now belongs exclusively to the installed
// app and this script must never point at it again — that is the production vault.
const targets = [
  { label: "userData     ", dir: path.join(process.env.APPDATA, `${productName} (dev)`) }, // Roaming — dev registry + dev org DBs
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
