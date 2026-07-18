# PURGE-REPORT — Frontend dead-code purge + Config-as-Data completion (2026-07-03)

## Step 1 — Dead code deleted
- `src/icons.tsx`: deleted 10 orphaned exports — Close, Home, PeopleSm, Clock, Clients, Image, TabProspects, TabPipeline, TabSales, Scan (~40 lines).
- `src/globals.css`: deleted `.navsec`, `.clientitem`, `.dot` (flyout leftovers).
- `src/globals.css`: deleted client/org page block — `.orghead`, `.orgava`, `.orgname`, `.privpill`, `.tabstrip`, `.tab`, `.counter`.
- `src/globals.css`: deleted CRM toolbar/table chrome — `.toolbar`, `.crmtable`, `.biz`, `.scorepill`, `.s-hot/.s-warm/.s-low`, `.web`, `.srctag`, `.when`, `.minibtn`.
- `src/globals.css`: deleted kanban block — `.kanban`, `.kcol`, `.khead`, `.kdot`, `.kbody`, `.kcard`, `.v-rest/.v-dental/.v-contractor`, `.kstack`, `.kgh`.
- `src/globals.css`: deleted sales block — `.salesgrid`, `.pitch`.
- `src/globals.css`: deleted clients directory block — `.clienttable`, `table.clients` (incl. mobile media query), `.corg`, `.cmeta`, `.chrs`, `.cstatus`, `.cs-*`.
- CSS total: ~110 lines removed (353 → 243). Kept per recon: `.btn`, `.hint`, generic `table/thead/tbody` element rules (load-bearing for the Data Viewer grid), `.modal`, `.avatar`, `.crumbs`, `.overlay`, `.searchbox`, `.pill`, `.door`, all `.dv-*`/`.frw*`/`.bootterm`/`.safemode`/`.setrow`/`.switch`.

## Step 2 — Watchlist cleanup
- `src/views/Home.tsx`: removed hardcoded GetScriptClips/Vault cards; now takes a `modules: ModuleRow[]` prop and maps enabled rows to cards (same source/filter as Flyout). Data Viewer card stays hardcoded — core surface, not a module.
- `src/App.tsx`: Home mount now passes `modules={activeModules}` (one line).
- `electron/core/windows.ts`: deleted `miniWindow` var, `setMiniWindow`, `getMiniWindow`; `broadcast()` targets main window only; header updated.
- `electron/diag.ts`: dropped `getMiniWindow` import; `wcListeners()` reads main window only; stale mini-window note removed from session_start.

## Step 3 — Verification
- `npm run build`: clean (renderer + main).
- `npx tsc --noEmit`: exit 0 — zero broken imports.
- Launch test (12s, real app): alive until timeout kill; no errors beyond the known dev-gated `diag:enabled` probe.
