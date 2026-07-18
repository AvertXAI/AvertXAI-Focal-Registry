/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// DIAG-2 (renderer half) — SHELL-level per-module activity registry. Dev-gated: dormant unless
// main answers diag:enabled === true (env DIAG=1). Any renderer surface bumps its OWN bucket;
// the single 2s reporter ships a perModule map to main, then snapshots. Reversible: delete this
// file + the bump*/setSubs/startDiagReporter calls in the shell + modules.
// Cost when off: a boolean check per render (immeasurable); no interval, no growth.

let on = false;
interface Bucket { renders: number; stateSets: number; subs: number }
const buckets: Record<string, Bucket> = {};
function bucket(name: string): Bucket {
  return (buckets[name] ??= { renders: 0, stateSets: 0, subs: 0 });
}

/** Bump once per render of a named surface (module / rail / a shell view). No-op unless DIAG=1. */
export function bumpRender(module: string): void {
  if (on) bucket(module).renders++;
}
/** Bump once per renderer state-set for a surface (e.g. per onTick setState). No-op unless DIAG=1. */
export function bumpStateSet(module: string): void {
  if (on) bucket(module).stateSets++;
}
/** Snapshot a surface's live subscription count (so a listener leak shows as a rising `subs`).
 *  NOT gated on `on`: the subscribing effect runs at mount, often BEFORE main confirms DIAG=1.
 *  Storing unconditionally (a single number per surface, no growth) ensures the real count ships. */
export function setSubs(module: string, n: number): void {
  bucket(module).subs = n;
}

let started = false;
/**
 * Start the single renderer reporter (call once from the always-mounted shell). Asks main whether
 * DIAG is on; if so, every 2000ms ships per-module deltas (renders/stateSets) + the live subs
 * snapshot, then records the new baseline. Shell-level on purpose: surfaces only bump when they
 * actually render, so the map reveals WHICH surface churns — and whether anything churns on a
 * non-TimeTracker view.
 */
export function startDiagReporter(): void {
  if (started) return;
  started = true;
  void window.api.diag
    ?.enabled()
    .then((enabled) => {
      if (!enabled) return;
      on = true;
      const last: Record<string, { renders: number; stateSets: number }> = {};
      window.setInterval(() => {
        const perModule: Record<string, Bucket> = {};
        for (const [name, cur] of Object.entries(buckets)) {
          const prev = last[name] ?? { renders: 0, stateSets: 0 };
          perModule[name] = {
            renders: cur.renders - prev.renders,
            stateSets: cur.stateSets - prev.stateSets,
            subs: cur.subs, // snapshot, not a delta
          };
          last[name] = { renders: cur.renders, stateSets: cur.stateSets };
        }
        window.api.diag!.perModule(perModule);
      }, 2000);
    })
    .catch(() => {
      /* no diag:enabled handler => DIAG off => stay dormant */
    });
}
