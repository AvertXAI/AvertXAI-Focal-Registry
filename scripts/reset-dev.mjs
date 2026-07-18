/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Dev reset — wipes the platform registry so the next boot runs the First-Run wizard again.
// Deletes the registry file outright (initRegistry() recreates the schema on boot) instead of
// opening it with better-sqlite3: that module is Electron-ABI so plain `node` can't load it,
// and leaking ELECTRON_RUN_AS_NODE=1 into the `npm run dev` chain breaks `electron .`.
// Org-scoped .db files are left on disk (never routed to once deregistered) — delete by hand
// from %APPDATA%/runbooks if you want them gone too.
import fs from "node:fs";
import path from "node:path";

const userData = path.join(process.env.APPDATA, "runbooks");
let removed = false;
for (const f of ["platform_registry.db", "platform_registry.db-wal", "platform_registry.db-shm"]) {
  const p = path.join(userData, f);
  if (fs.existsSync(p)) {
    fs.rmSync(p);
    removed = true;
  }
}
console.log(
  removed
    ? "reset-dev: removed platform_registry.db — next boot shows the First-Run wizard"
    : "reset-dev: no platform_registry.db — already clean"
);
