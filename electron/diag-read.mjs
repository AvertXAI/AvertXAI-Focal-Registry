/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// DIAG-2 reader — pure Node, no deps. Reads a diag-*.jsonl and prints:
//   (1) the top-level slope table (ourCpu / rendersPerSample / tickStateSets / mainRssKB / …)
//   (2) a PER-MODULE table — renders/stateSets/subs slopes per surface — to pinpoint WHICH
//       surface drives the floor. Rising = accumulation; flat = cleared.
//   usage:  node CRM/electron/diag-read.mjs <path-to-diag.jsonl>
import fs from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node diag-read.mjs <diag-*.jsonl>"); process.exit(1); }

const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const samples = lines.filter((l) => l.type === "sample");
const flags = lines.filter((l) => l.type === "sustained_high_cpu");
if (samples.length === 0) { console.error("no samples in file"); process.exit(1); }

const start = samples[0].ts, end = samples[samples.length - 1].ts;
const durMin = ((end - start) / 60000).toFixed(1);
const decile = Math.max(1, Math.floor(samples.length / 10));
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r2 = (n) => Math.round(n * 100) / 100;
const sig = (d) => (d > 0.5 ? "RISING (suspect)" : d < -0.5 ? "falling" : "flat (cleared)");

function slope(vals) {
  const first = avg(vals.slice(0, decile));
  const lastD = avg(vals.slice(-decile));
  return { first: r2(first), last: r2(lastD), delta: r2(lastD - first), peak: r2(Math.max(...vals, 0)) };
}
function row(label, vals) {
  const s = slope(vals);
  console.log(
    `${label.padEnd(20)} ${String(s.first).padStart(9)} ${String(s.last).padStart(9)} ${String(s.delta).padStart(9)} ${String(s.peak).padStart(8)}   ${sig(s.delta)}`
  );
}

console.log(`file: ${file}`);
console.log(`samples: ${samples.length}  duration: ${durMin} min  (decile = ${decile} samples each end)`);
console.log(`sustained_high_cpu FLAGs: ${flags.length}${flags.length ? "  first@" + new Date(flags[0].ts).toISOString() : ""}`);

console.log("\n== TOP-LEVEL ==");
console.log("metric                first10%   last10%     delta     peak   => signature");
for (const m of ["ourCpu", "rendersPerSample", "tickStateSets", "mainRssKB", "activeTimerCount", "wcListeners"]) {
  row(m, samples.map((s) => s[m] ?? 0));
}

// per-module: union of names across all samples
const names = [...new Set(samples.flatMap((s) => Object.keys(s.perModule ?? {})))].sort();
console.log("\n== PER-MODULE (renderer activity, NOT cpu) ==");
if (names.length === 0) {
  console.log("(no perModule data — DIAG-1 file, or no surfaces reported)");
} else {
  console.log("module.metric         first10%   last10%     delta     peak   => signature");
  for (const name of names) {
    for (const metric of ["renders", "stateSets", "subs"]) {
      row(`${name}.${metric}`, samples.map((s) => s.perModule?.[name]?.[metric] ?? 0));
    }
  }
}
