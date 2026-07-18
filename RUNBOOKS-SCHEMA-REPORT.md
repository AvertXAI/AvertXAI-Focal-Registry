RUNBOOKS-SCHEMA-REPORT — Core App Logic phase, schema + IPC (2026-07-03)

Recon
- Tables are created in `initDb()` (`electron/core/brain/db/index.ts`) via `createTable(db, name, columns)`, which injects the standard `id`/`uuid`/`created_at`/`updated_at` columns; migrations are additive (`CREATE TABLE IF NOT EXISTS`) and run on every boot.

Schema
- `electron/core/brain/db/index.ts`: added `runbooks` table — standard columns + `title TEXT NOT NULL`, `description TEXT`.
- `electron/core/brain/db/index.ts`: added `runbook_steps` table — standard columns + `runbook_id INTEGER NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE`, `step_order INTEGER NOT NULL DEFAULT 0`, `prompt_template TEXT` (FKs enforced — `foreign_keys = ON` is set per connection).

Brain + IPC
- `electron/core/brain/runbooks/index.ts` (new): `listRunbooks()` (all rows, newest first) and `createRunbook(title, description)` — validates the raw `unknown` IPC args (non-empty string title; string/null description), inserts with an app-generated UUIDv7, returns the created row.
- `electron/core/ipc.ts`: registered `runbooks:list` and `runbooks:create`, thin delegation per the layer rule.
- `electron/core/preload.ts`: exposed `window.api.runbooks.list()` / `.create(title, description?)`.

Types
- `src/shared/types.ts`: added `Runbook` and `RunbookStep` interfaces (standard columns included) and the `Api.runbooks` surface.

Verification
- `npm run build`: clean. `npx tsc --noEmit`: exit 0.
- Electron smoke test (temp userData, 14 assertions): both tables carry the standard columns; create/list round-trip; UUIDv7 on rows; `description` nullable; FK rejected for a bogus `runbook_id`; `ON DELETE CASCADE` removes orphaned steps; `""`/`42` titles and non-string description throw. SMOKE OK.
