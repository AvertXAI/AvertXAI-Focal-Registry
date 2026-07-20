// Uploads in the ONLY safe order, then proves the feed is live.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const HOST = "avert-core-01";
const DEST = "/data/focal-updates/prerelease";
const { version } = createRequire(import.meta.url)("../package.json");

// Name-pinned selection — first-match find() is unsafe here: the portable target emits a second
// .exe, electron-builder always writes builder-debug.yml, and release/ is not cleaned between builds
// (stale 0.1.x artifacts linger). Pin the CURRENT version's Setup installer, its blockmap, and the
// real channel manifest; assert each exists before any upload.
const exe = `AvertXAI-Focal-Registry-Setup-${version}.exe`;
const map = `${exe}.blockmap`;
const yml = "prerelease.yml";

for (const f of [exe, map, yml]) {
  if (!existsSync(path.join("release", f))) {
    console.error(`MISSING ARTIFACT: release/${f}`);
    console.error("Refusing to publish a partial release.");
    process.exit(1);
  }
}

const run = c => execSync(c, { stdio: "inherit" });

// ORDER IS LOAD-BEARING. The .yml is the trigger: publish it before the
// payload and a client can request a file that is still in flight.
console.log("1/3  payload…");
run(`scp "release/${exe}" "release/${map}" ${HOST}:${DEST}/`);

console.log("2/3  manifest…");
run(`scp "release/${yml}" ${HOST}:${DEST}/`);

console.log("3/3  verifying feed…");
const head = execSync(
  `curl -s -o /dev/null -w "%{http_code}" https://updates.focalregistry.com/prerelease/${yml}`
).toString().trim();

if (head !== "200") {
  console.error(`FEED NOT LIVE — got ${head}. Paul will not see this release.`);
  process.exit(1);
}
console.log(`✅  v${version} published and verified.`);
