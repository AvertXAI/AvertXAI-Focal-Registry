// Uploads in the ONLY safe order, then proves the feed is live.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HOST = "avert-core-01";
const DEST = "/data/focal-updates/prerelease";
const FEED_ROOT = "/data/focal-updates"; // REVISIONS.md lives at the feed ROOT, not in prerelease/
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = createRequire(import.meta.url)("../package.json");

// Name-pinned selection — first-match find() is unsafe here: the portable target emits a second
// .exe, electron-builder always writes builder-debug.yml, and release/ is not cleaned between builds
// (stale 0.1.x artifacts linger). Pin the CURRENT version's Setup installer, its blockmap, and the
// real channel manifest; assert each exists before any upload.
const exe = `Focal-Registry-Setup-${version}.exe`;
const map = `${exe}.blockmap`;
const yml = "prerelease.yml";

for (const f of [exe, map, yml]) {
  if (!existsSync(path.join("release", f))) {
    console.error(`MISSING ARTIFACT: release/${f}`);
    console.error("Refusing to publish a partial release.");
    process.exit(1);
  }
}

// ---- REVISIONS.md → releaseNotes ------------------------------------------------------------
// REVISIONS.md is the single source of release copy. The version being published MUST have a
// section whose Summary is present and ≤ 400 characters — that Summary becomes the manifest's
// releaseNotes (what the in-app Software Update window shows). Missing/oversized = hard fail:
// a release without notes is a broken release, not a cosmetic gap.
const REVISIONS = path.join(repoRoot, "REVISIONS.md");
if (!existsSync(REVISIONS)) {
  console.error("MISSING: REVISIONS.md at the repo root. Refusing to publish without release notes.");
  process.exit(1);
}
const revisions = readFileSync(REVISIONS, "utf8");
// Section = "## <version> — <date>" up to the next "## " or EOF.
const section = revisions.split(/^## /m).find((s) => s.startsWith(`${version} `) || s.startsWith(`${version} —`) || s.startsWith(`${version}\n`));
if (!section) {
  console.error(`REVISIONS.md has no "## ${version}" section. Add one before releasing.`);
  process.exit(1);
}
// Summary = the "**Summary:**" paragraph (runs until a blank line or the next heading).
const sumMatch = section.match(/\*\*Summary:\*\*\s*([\s\S]*?)(?:\n\s*\n|\n#)/);
const summary = sumMatch ? sumMatch[1].replace(/\s+/g, " ").trim() : "";
if (!summary) {
  console.error(`REVISIONS.md ${version}: no **Summary:** block found. Add one before releasing.`);
  process.exit(1);
}
if (/placeholder/i.test(summary)) {
  console.error(`REVISIONS.md ${version}: the Summary is still a placeholder. Write it before releasing.`);
  process.exit(1);
}
if (summary.length > 400) {
  console.error(`REVISIONS.md ${version}: Summary is ${summary.length} characters — the limit is 400.`);
  console.error("The update window shows this verbatim; trim it (Details can hold the rest).");
  process.exit(1);
}

// Inject into the manifest electron-builder wrote. YAML single-quoted scalar: escaping is only
// ' → '' — no other character is special, so the 400-char plain-text summary embeds safely.
const ymlPath = path.join("release", yml);
let manifest = readFileSync(ymlPath, "utf8");
manifest = manifest.replace(/^releaseNotes:.*(?:\n(?: {2}).*)*\n/m, ""); // idempotent re-run: drop a prior injection
manifest += `releaseNotes: '${summary.replace(/'/g, "''")}'\n`;
writeFileSync(ymlPath, manifest);
console.log(`0/4  releaseNotes injected (${summary.length} chars) from REVISIONS.md`);

const run = c => execSync(c, { stdio: "inherit" });

// ORDER IS LOAD-BEARING. The .yml is the trigger: publish it before the
// payload and a client can request a file that is still in flight.
console.log("1/4  payload…");
run(`scp "release/${exe}" "release/${map}" ${HOST}:${DEST}/`);

console.log("2/4  manifest…");
run(`scp "release/${yml}" ${HOST}:${DEST}/`);

// REVISIONS.md → feed ROOT (full changelog for the website + the update window's details fetch).
// After the manifest: it is presentation, never the trigger.
console.log("3/4  revisions…");
run(`scp "${REVISIONS}" ${HOST}:${FEED_ROOT}/`);

console.log("4/4  verifying feed…");
const head = execSync(
  `curl -s -o /dev/null -w "%{http_code}" https://updates.focalregistry.com/prerelease/${yml}`
).toString().trim();

if (head !== "200") {
  console.error(`FEED NOT LIVE — got ${head}. Paul will not see this release.`);
  process.exit(1);
}
console.log(`✅  v${version} published and verified.`);
