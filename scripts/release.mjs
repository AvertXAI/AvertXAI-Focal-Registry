// Uploads in the ONLY safe order, then proves the feed is live.
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";

const HOST = "avert-core-01";
const DEST = "/data/focal-updates/prerelease";
const { version } = createRequire(import.meta.url)("../package.json");

const files = readdirSync("release");
const exe   = files.find(f => f.endsWith(".exe"));
const map   = files.find(f => f.endsWith(".blockmap"));
const yml   = files.find(f => f.endsWith(".yml"));

if (!exe || !map || !yml) {
  console.error("MISSING ARTIFACT — refusing to publish a partial release.");
  console.error({ exe, map, yml });
  process.exit(1);
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
