# FR-CANON-5.md — Focal Registry scoped canon INDEX

**Read this first. Read the four files below before any task.**

*Derived 2026-07-31 from real canon: `CANON-2` · `DECISIONS-51` · `RULES-39` · `STATUS-36` · `PROJECTS-9` · `FACTS-10`, plus repo `CLAUDE.md` and the completed TimeTracker port.*

---

## ⚠ How to find these files — read this before anything else

**Never reference a scoped canon file by its version number.** Every rotation deletes the old file and adds the next number. A hardcoded filename is guaranteed to be missing after the next rotation, and an agent that stops on a missing file is an agent stopped by design working correctly.

**The correct bootstrap, always:**

1. List `CANON/` .
2. Load the **highest-numbered** `FR-CANON-*.md` — that is this index.
3. Load the **highest-numbered** version of each of the four files below.
4. A gap in the numbering is normal. Files rotate independently and their numbers will not match each other.

**Missing lower-numbered files are not an error.** `FR-CANON-1.md` being absent means rotation happened, not that canon is broken. Only an empty `CANON/` directory is a blocker.

---

## What these files are

**Scoped canon for `D:\dev\AvertXAI-Focal-Registry` only.** Every entry here governs this repo. Everything in real canon about other products, business administration, or infrastructure this repo never touches has been dropped.

| File | Holds |
|---|---|
| `FR-FACTS-N.md` | Verified facts — versions, sizes, licences, identifiers, endpoints |
| `FR-RULES-N.md` | How work is done here — gates, discipline, bans |
| `FR-DECISIONS-N.md` | Settled product and architecture choices. Do not reopen |
| `FR-STATUS-N.md` | What is built, in flight, and not started |

## The rules that govern these files

1. **Real canon at `D:\dev\_source\AvertXAI-CANON\CANON PROJECT\` remains authoritative for the operation.** It is an index plus five files: `CANON-N` · `FACTS-N` · `STATUS-N` · `DECISIONS-N` · `RULES-N` · `PROJECTS-N`, each loaded at its highest number. These scoped files are authoritative **for this repo**.
2. **Where these and real canon disagree, these win for this repo** — they are newer and written against verified code. Real canon is corrected separately by Jason.
3. **You never edit any of these files.** Discrepancies go to `CANON-UPDATES.md` and stop there.
4. **Silence is not permission.** If these files say nothing about something, read real canon before concluding no rule exists.
5. **Never modify, move, or delete a real canon file.** Read-only, permanently.

## Regenerate when

Any real canon file rotates to a higher version number, or a decision here is superseded by Jason. **Generated, never authored** — the Canon Distributor produces these; hand edits are lost on the next run.
