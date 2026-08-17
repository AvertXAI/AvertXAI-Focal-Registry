# CANON-3.md — Index

The canon is these **five** files. Read them on any AvertXAI topic, before other memory. Load the **highest-numbered version** of each. **Canon overrides memory on conflict.**
*(Supersedes CANON-2 — delete it after upload. Rotated 2026-08-14 alongside DECISIONS-52 · STATUS-38 · RULES-40 · PROJECTS-10. FACTS-10 unchanged this rotation.)*

| File | Holds | Route here when the question is… |
|---|---|---|
| **FACTS-N.md** | Verified facts — prices, specs, licences, platform traps, identifiers | "Is this true regardless of what Jason chose?" |
| **STATUS-N.md** | Product state — LIVE / PARKED / DEAD | "Is this being built, parked, or killed?" |
| **DECISIONS-N.md** | Settled choices — pricing, direction, architecture, model picks | "Did Jason choose this, and is it closed?" |
| **RULES-N.md** | How the operation runs — stack, conventions, gates, comms, canon maintenance | "Is this a standing 'how we do things' rule?" |
| **PROJECTS-N.md** | Master project inventory + the file index for everything in project knowledge | "What exists, what state is it in, and where is the document?" |

## Where canon lives

- **Authoritative:** `D:\dev\_source\AvertXAI-CANON\CANON PROJECT\`
- **Claude project knowledge:** the same files, uploaded
- **Per repo:** the Canon Distributor syncs copies into each project's `CANON/`

**All three must hold the same version. If they disagree, the `_source` folder wins and the others get resynced.**

## Scoped canon — per repo

A repo may carry a **scoped canon set** — an index plus FACTS / RULES / DECISIONS / STATUS, filtered to that repo and prefixed so it can never be confused with operation canon (e.g. `FR-DECISIONS-1.md` for Focal Registry).

- **Generated, never authored.** Regenerate when a source canon file rotates; never hand-edit.
- **Scoped canon is authoritative for its repo** — it is newer and written against verified code. Operation canon stays authoritative for the operation.
- Roughly a 6:1 reduction. An engineer in one repo reads what governs that repo and nothing else.
- **Silence in scoped canon is not permission.** Read real canon before concluding no rule exists.

## `CANON-UPDATES.md` — the feedback loop

Each repo keeps an **append-only** ledger of canon-versus-ground-truth discrepancies, tagged `CONTRADICTS` · `STALE` · `GAP` · `BETTER` · `REDUNDANT`, each with `file:line` receipts.

**The agent records. It never acts, and it never edits a canon file.** Canon governs until Jason rules. Jason hands the ledger to Claude, and real canon is corrected on the next rotation.

This exists because canon is written from conversation while the agent reads the code — and the code is where staleness shows up first.

## Maintenance

- **Terse: current state only, one line, no change-history.**
- **To change a file: version up (FACTS-1 → FACTS-2), upload, delete the old one.** A re-upload duplicates rather than overwrites, and a stale lower-numbered copy is what an agent may read.
- **Never edit a published canon file.** Any further change takes the next number.
- New information must pass the distinctness test above — if it overlaps an existing file, it goes there rather than into a new one.
- **No agent may modify, move, or delete a canon file.** Read-only to every agent, permanently.
