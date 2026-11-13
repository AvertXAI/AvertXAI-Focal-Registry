// Bundles and runs every tests/*.test.ts.
// A *.db.test.ts needs SQLite, and the SQLite native module is built for Electron's Node, so those
// run under Electron-as-Node: no window, no app code path, fake databases under the temp folder.
// Everything else runs under plain Node.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const out = path.join(root, "out", "tests");
const only = process.argv.slice(2);
const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.ts") && (only.length === 0 || only.some((word) => f.includes(word))))
  .sort();

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env }, shell: cmd.endsWith(".cmd") });
  return result.status ?? 1;
}

const esbuild = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "esbuild.cmd" : "esbuild");
const built = run(esbuild, [
  ...files.map((f) => `tests/${f}`),
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--outdir=out/tests",
  "--out-extension:.js=.cjs",
  "--external:electron",
  "--external:better-sqlite3-multiple-ciphers",
  "--external:argon2",
  "--loader:.css=empty",
  "--log-level=warning",
]);
if (built !== 0) process.exit(1);

const failed = [];
for (const f of files) {
  const file = path.join(out, f.replace(/\.ts$/, ".cjs"));
  const status = f.endsWith(".db.test.ts")
    ? run(require("electron"), [file], { ELECTRON_RUN_AS_NODE: "1" })
    : run(process.execPath, ["--test", file]);
  if (status !== 0) failed.push(f);
}
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : `\nall ${files.length} test files passed`);
process.exit(failed.length ? 1 : 0);
