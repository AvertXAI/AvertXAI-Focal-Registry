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

console.log("OK dev host built — host.cjs, preload.cjs, renderer.js");
