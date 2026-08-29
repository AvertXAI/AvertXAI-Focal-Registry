/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The house loading panel — MindMerge's, adopted verbatim (Jason 08-11-2026: "when loading notes
// like mindmerge does, make sure it has this loading screen"). Centred ring, a sentence in plain
// English, and a monospace progress line beneath it.
//
// THE PROGRESS LINE IS OPTIONAL, AND THAT IS THE WHOLE DESIGN DECISION HERE. MindMerge can say
// "Reading 672 of 1,965 files · 34%" because it walks a folder and genuinely knows both numbers.
// Most of the Vault's reads are ONE SQLite query against an already-open connection — there is no
// 672, there is no 1,965, and inventing them would be a progress bar that lies. So `done`/`total`
// are omitted wherever the count is not real, and the panel simply shows the ring and the sentence.
// Where the Vault DOES walk files — the document import — the numbers are true and get shown.
//
// The ring honours prefers-reduced-motion through .mm-loadring's own prefers-reduced-motion query (mindmerge.css:498); the text
// and the counter carry the meaning on their own, so only the spin is dropped.

export interface LoadingProps {
  /** Plain sentence, sentence case, no shouting. "Loading your notes…" */
  message: string;
  /** Supply BOTH to show the counter, or neither. A count of one unknown half is worse than none. */
  done?: number;
  total?: number;
  /** What is being counted, for the line "Reading 672 of 1,965 files". */
  unit?: string;
  /** Tight variant for inside a modal, where a 260px-tall panel would push the actions off-screen. */
  compact?: boolean;
}

export default function Loading({ message, done, total, unit = "files", compact = false }: LoadingProps) {
  const counted = typeof done === "number" && typeof total === "number" && total > 0;
  const pct = counted ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className={`mm-loading${compact ? " compact" : ""}`} role="status" aria-live="polite">
      <div className="mm-loadring" />
      <div className="mm-loadmsg">{message}</div>
      {counted && (
        <div className="mm-loadcount">
          Reading {done.toLocaleString()} of {total.toLocaleString()} {unit} · {pct}%
        </div>
      )}
    </div>
  );
}
