// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry — Vault standalone lane
// Description: Builds the dev host — three bundles, no config files, no new dependencies. Uses the
//              repo's own esbuild and Electron. Native modules stay external exactly as the real
//              build does. Never ships; a developer tool.
//              Run:  node modules/vault/dev/build.mjs
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: modules/vault/dev/build.mjs
//------------------------------------------------------------
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTERNAL = ["electron", "better-sqlite3-multiple-ciphers", "argon2"];

await build({
  entryPoints: [path.join(HERE, "host.ts")],
  outfile: path.join(HERE, "host.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: EXTERNAL,
});

await build({
  entryPoints: [path.join(HERE, "preload.ts")],
  outfile: path.join(HERE, "preload.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  external: EXTERNAL,
});

// The renderer is a browser bundle — React comes along, the CSS is emitted beside it and the HTML
// pulls it in. `loader` keeps the module's own stylesheet import working without a bundler config.
await build({
  entryPoints: [path.join(HERE, "renderer.tsx")],
  outfile: path.join(HERE, "renderer.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "css" },
});

// Brand icons must sit BESIDE index.html. The dev host loads over file://, where a leading-slash
// path resolves to the filesystem root and every tile 404s silently into a broken image — and
// fetch()/XHR against file:// is blocked outright, so a runtime-loaded icon pack is not an option
// either. Copying the files next to the HTML and referencing them relatively is what actually works.
// COPY-BACK NOTE: in the real shell these belong in the Vite asset pipeline (import.meta.glob with
// query:"?url", or public/ with base:'./'), and ICON_BASE in brandTile.ts is the single line that
// changes. That wiring is root-lane and deliberately not done here.
const ICON_SRC = path.join(HERE, "..", "assets", "brand-icons");
const ICON_DEST = path.join(HERE, "brand-icons");
if (fs.existsSync(ICON_SRC)) {
  fs.rmSync(ICON_DEST, { recursive: true, force: true });
  fs.cpSync(ICON_SRC, ICON_DEST, { recursive: true });
  console.log(`OK copied ${fs.readdirSync(ICON_DEST).length} brand icons beside index.html`);
}

console.log("OK dev host built — host.cjs, preload.cjs, renderer.js");
