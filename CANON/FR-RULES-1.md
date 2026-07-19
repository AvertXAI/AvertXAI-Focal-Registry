# FR-RULES-1.md — how work is done in this repo

One line each. *(Derived 2026-07-19 from RULES-35 + repo CLAUDE.md. Rules for other products, stacks, and business administration were dropped.)*

## Session bootstrap
- **Read `FR-CANON-1.md` and its four files BEFORE reading the task.** Not conditional on the prompt mentioning it. A prompt that forgets does not excuse skipping.
- Then read `CANON-UPDATES.md` — known discrepancies. Know they exist; do not act on them.
- If these scoped files are missing or their source canon versions have rotated, regenerate them first and report.

## Reporting
- Source-confidence labels on every claim: Verified Data · Real Data · My Speculation · Industry Convention · Unknown. An unlabelled claim is a defect.
- Every report structure: Verified / Inferred / Assumed / Unknown / NOT FOUND / Blockers.
- **Write the full report to a FILE** at `D:\dev\_source\AvertXAI-Focal-Registry\reports\REPORT-<topic>-<YYYY-MM-DD>.md`. One file per session, never append to a previous one. Everything goes in the file — receipts, diffs, row counts, grep output. Chat is a summary. Close with the absolute path. **Jason works from a phone and cannot select text.**
- Numbered ambiguities with a lean flagged go BEFORE the artifact, never after.

## Investigate first
- Read-only recon with `file:line` receipts before any edit. Write `NOT FOUND` explicitly where something expected is absent.
- Never assume a class name, column, wiring pattern, or signature from memory.
- If recon contradicts the task premise, STOP and report. Do not proceed on a disproved premise.
- **Never claim a UI works from reading markup.** Prove it with width math or a render, or say it needs Jason's on-device check.

## Gates and commits
- **Gate with `&&`, never `;`.** A red `tsc` must make the commit impossible.
- `npx tsc --noEmit` and `npm run build` both exit 0 before every commit.
- **Every change report pastes the literal `git diff`.** An empty diff means the edit did not happen — say so.
- **Explicit-path staging only. Never `git add -A`.** (`git add -u` for a large tracked-file sweep is acceptable; flag it.)
- Device-gate before commit. **Kill every `electron.exe` AND `AvertXAI Focal Registry.exe` first** — both share the single-instance lock and a stale window fakes false results.
- Verify UI changes in all three themes.
- **No `Co-Authored-By` trailer** in any commit message or pull request.
- Approve-once: when Jason approves a multi-step plan, run every step without checking in between. Stop only on an error, ambiguous output, scope expansion, or an unplanned destructive operation.

## Dependencies — the licence gate
- **ALLOWED without asking:** MIT · BSD-2 · BSD-3 · Apache-2.0 · ISC · Unlicense · CC0
- **STOP AND ASK, every time:** GPL · AGPL · LGPL · SSPL · BUSL · PolyForm · Elastic · source-available · non-commercial · dual-licence · undeterminable
- **Report the licence BEFORE installing. Not after. Do not install to measure it.**
- When a licence is not allowed: report it, name **two permissive alternatives**, and include **writing it ourselves** with a cost estimate in lines and days. That option is always on the table.
- **"Industry standard" is not a licence.** The reflexive answer is usually the popular package, and the popular package is often the one with the problem.
- Applies to **binaries the app ships**, not only linked code.
- **Report installed size before committing.** Over 20 MB → stop and report.

## Canon discipline
- **Never modify, move, or delete a canon file** — real or scoped. Read-only, permanently.
- Discrepancies go to `CANON-UPDATES.md` in the §2.12 format: tag · what canon says · reality · evidence · suggestion · severity.
- **You record. You do not act.** Canon governs until Jason rules, even when you are certain it is wrong.
- Every entry needs a receipt. A discrepancy without evidence is an opinion.
- Line-number citations rot. Cite them in a report; carry only values and structures into durable documents.

## Build discipline
- **Stay in your lane.** Module work stays in `src/modules/<slug>/` and `electron/core/services/<slug>/`. Shell wiring is a separately authorized task.
- **Mockup before UI, always.** HTML mockup approved before any scaffold.
- **Build it right the first time.** No throwaway shortcuts, no "fast but disposable" option offered.
- Task surface = request surface. No unsolicited alternatives, sequencing advice, or adjacent suggestions.
- **Destructive-action warnings go at the TOP**, before step 1. Never as a postscript.
- Migrations are additive and guarded — `PRAGMA table_info` before any `ALTER`, safe to re-run, never drop or recreate.
- **Never `npm run dev:clean`** — it deletes `platform_registry.db`.
- Operational knowledge capture: every repeatable procedure becomes `RB-NNN-slug.md` in `D:\dev\_source\AvertXAI-RUNBOOKS\` the same session.

## Release
- A release is **ONE deliberate command** run by a person who just watched the build succeed. **Never a watch-folder or auto-publish pipeline.** The device gate extends to shipped builds, not just commits.
- Upload payload before manifest.
- Self-hosted git forges are rejected as update hosts — electron-builder has no provider for any of them.
