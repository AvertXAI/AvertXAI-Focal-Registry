// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: The vault's OWN settings store — config-as-data, rows read at runtime, never a
//              hardcoded renderer constant and never app_settings in the shared database. Canon:
//              "The Vault owns its own settings. The application's Settings page carries no vault
//              controls, ever." ONE DEFAULTS const is the single source of truth and NOTHING IS EVER
//              SEEDED — the structural fix for TimeTracker's break_enabled bug, where a seeded row
//              and a default disagreed and turning the setting off did not stick. A key is written
//              only when the user actually changes it. Electron-free.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/settings.ts
//------------------------------------------------------------
import { nowIso, type Db } from "./db";
import { generateUUIDv7 } from "../utils/uuidv7";
import { forgetMinLevel } from "./log";

/**
 * THE single source of truth for every vault preference. A key absent from the table reads its
 * value from here; nothing is pre-written. Values are strings because the store is key/value —
 * the typed readers below are the only place parsing happens.
 */
export const VAULT_DEFAULTS = {
  // The master-password seam. [master-password-placeholder] — see lock.ts.
  "lock.enabled": "1",
  "lock.auto_minutes": "0", // 0 = never auto-lock. The timer is a later build; the row exists now.
  "lock.on_minimize": "0",
  "lock.wipe_after_failures": "0", // 0 = never. Jason's stolen-laptop concept; OFF until ruled.
  "clipboard.clear_seconds": "30",
  // Presentation — remembered across navigation, per canon (view state persists to the database).
  "view.mode": "list", // 'list' | 'grid'
  "view.sort": "label", // 'label' | 'recent' | 'kind'
  "view.show_archived": "0",
  // Generator preferences, so a photographer's chosen shape survives the app closing.
  "generator.length": "16",
  "generator.lowercase": "1",
  "generator.uppercase": "1",
  "generator.numbers": "1",
  "generator.symbols": "1",
  "generator.exclude_similar": "0",
  "generator.exclude_ambiguous": "0",
  "generator.no_repeats": "0",
  // Health thresholds — a setting, never a constant, so "stale" can be tuned without a build.
  "health.stale_days": "90",
  "health.min_length": "12",
  // Dark-web exposure checks (XposedOrNot). THE ONLY FEATURE IN THE VAULT THAT TOUCHES THE
  // NETWORK, and therefore OFF until the user turns it on — see breach.ts for what each check
  // does and does not send.
  "breach.enabled": "0",
  // ---- redesign (08-10-2026, MOCKUP-vault-full-v2) ----
  // The section on screen (home | passwords | notes | infra | repos | settings) and the sidebar's
  // collapse — view state, persisted like every other preference: a row, never localStorage.
  "view.section": "passwords",
  "view.sidebar_collapsed": "0",
  // Which list style the notes pane shows (note | runbook | snippet) and the editor mode.
  "notes.style": "note",
  "notes.editor_mode": "split",
  // The middle list's collapse, remembered like every other view preference (Jason 08-12-2026).
  "notes.list_collapsed": "0",
  // The selected notes folder (08-14-2026). -1 = Unfiled, the ruled first-ever default. Added the
  // day the renderer started writing it — an unwhitelisted key here rejects EVERY write, and the
  // renderer's optimistic-then-refetch recovery turned that into folder selections snapping back
  // and the open note slamming shut (Jason: "its bugged, it quickly opens and closes on me").
  "notes.folder_selected": "-1",
  // ---- draggable column widths (Jason 08-12-2026: "i need to adjust the vertical divider, one so
  // ---- i can read the folder completely, and the other for notes") ----
  // A 142-folder import produces names like "AvertXAI-BuildersAudit-Platform", and a fixed 232-pixel
  // rail truncates most of them to "AvertXAI-BuildersA…" — which makes two sibling folders
  // indistinguishable. Both are PIXEL widths, clamped renderer-side against the 740-pixel window
  // floor so a drag can never squeeze the editor out of existence.
  // The renderer clamps these on the way IN as well as on drag (Resizer.clampWidth) — a width stored
  // under an older, more generous ceiling must snap back rather than outlive it.
  /**
   * SIDEBAR WIDTH PER TAB — a JSON object keyed by section (Jason 08-12-2026: "each tab has its own
   * dividers, which should have its own measurements… i adjust notes, it changes it for passwords").
   *
   * One key holding a map rather than one key per section: sections are a product decision that
   * changes, and a whitelist that has to grow a row every time a tab is added is a whitelist someone
   * will forget to grow — which throws "Unknown vault setting" at boot. A missing section in this map
   * simply falls back to the default width, so a NEW tab needs no settings change at all.
   *
   * Parsed defensively renderer-side and every value re-clamped on read.
   */
  "sidebar.widths": "{}",
  // SUPERSEDED by sidebar.widths above, kept in the whitelist because a stored row still carries it
  // and dropping a key is a non-additive change (§3.9). Nothing reads it.
  "sidebar.width": "270",
  /**
   * THE LOCK. On = the sidebar has a drag handle and a live pixel dial; off = it is a plain border
   * at whatever width was last saved.
   *
   * ONE setting for both, not two, and NOT a held modifier key. Jason floated "hold control while
   * dragging to unlock" and asked whether he was over-engineering it — he was: a key you must hold
   * is re-negotiated every single time and is invisible on screen, whereas the thing he actually
   * wanted was a decision that stays made. A dial on a pane that cannot move is a readout of a
   * constant, so the two travel together.
   *
   * NOW OFF BY DEFAULT (Jason 08-20-2026) — this is the "turn it off before this ships" the line
   * below used to promise. The widths are calibrated: SIDE_DEFAULTS in Sidebar.tsx carries the four
   * per-section numbers he read off the dial, so the divider has nothing left to discover and a
   * drag handle on a settled layout is just a way to knock it out of true by accident.
   *
   * IT IS A DEFAULT, NOT A REMOVAL. The switch stays in Vault → Settings (SidebarEditor.tsx), and
   * it stays IN THE VAULT rather than moving to the shell Settings modal — Jason 08-20-2026: the
   * vault is encrypted, and someone without access should not learn what settings it has. Flipping
   * it back restores the handle and the dial together, which is why they were one setting.
   *
   * Reads fall through to this constant (getSetting: `row?.value ?? VAULT_DEFAULTS[key]`), so an
   * install that never touched the switch is locked by this change alone — no migration.
   */
  "sidebar.width_adjustable": "0",
  // KEPT THOUGH NOTHING READS IT. The note list is a constant now (NotesView.LIST_WIDTH), but a
  // stored row still carries this key and dropping it from the whitelist would be a non-additive
  // change (§3.9). An ignored row costs one line; a removed key costs a migration.
  "notes.list_width": "216",
  // WHICH FOLDERS ARE EXPANDED — a JSON array of folder ids (Jason 08-12-2026: "when i select a
  // folder, then switch tabs, then back to secured notes tab, the folders i expanded previously
  // didnt stay un-collapsed"). The tree is mounted only on the notes section, so switching tabs
  // unmounts it and React state cannot survive that. Section collapse is named in canon as view
  // state that persists to the database, so this is the sanctioned path, not a workaround.
  "notes.folders_open": "[]",
  // User-composed sidebar shortcuts — a JSON array of {type,id,label}. Composed in Settings or the
  // + Add shortcut modal; the sidebar renders it verbatim.
  "sidebar.shortcuts": "[]",
  // ---- the event log (08-11-2026) ----
  // The floor for what is KEPT: debug | info | warn | error. Default "info" — normal operation is
  // recorded, developer chatter is not. Dropping it to "debug" is the "turn the noise on" switch,
  // and it is a SETTING rather than a build flag so a problem on Jason's machine can be traced
  // without shipping him a different binary. See log.ts.
  "log.min_level": "info",
  // How many files one folder-import may take. Was a hardcoded 2,000 and it bit a legitimate
  // import of D:\dev\_source (Jason 08-11-2026). A setting, not a constant, because the right
  // ceiling depends on the tree — see walkForDocs for why a ceiling still exists at all.
  "import.max_files": "25000",
  // Scheduled compaction (Jason 08-12-2026). off | launch | daily | weekly. NOT per-delete: a full
  // VACUUM after one delete measured 2,158 ms and reclaimed nothing, so deletes do the free
  // incremental reclaim and this is the occasional full tidy. See compactIfDue for the guard that
  // stops it running when there is nothing to reclaim.
  "maintenance.compact_every": "weekly",
  /** Do not rebuild the whole file to win less than this. Megabytes. */
  "maintenance.compact_min_mb": "20",
  /**
   * ---- code-block appearance (Jason 08-13-2026, MOCKUP-vault-code-appearance-v1) ----
   *
   * ONE JSON PALETTE PER MODE, not one key per colour. A nine-role palette as nine keys would be
   * eighteen whitelist entries across two modes, and every future role would need another — a
   * whitelist that has to grow per colour is one somebody forgets to grow, and forgetting throws
   * "Unknown setting key" at boot and drops the shell into Safe Mode (§3.8). Same reasoning as
   * `sidebar.widths`.
   *
   * The value is either a BUILT-IN ID ("focal-dark") or a serialised CodeTheme. Anything that will
   * not parse falls back to the built-in for that mode — see readTheme; a bad stored palette must
   * never blank the preview.
   */
  "code.theme_dark": "focal-dark",
  "code.theme_light": "focal-light",
  /** Empty falls through to the shell's --mc-mono. Any font installed on the machine. */
  "code.font": "",
  "code.line_numbers": "0",
} as const;

export type VaultSettingKey = keyof typeof VAULT_DEFAULTS;

/** Every key the renderer may write. A key outside this list is refused at the trust boundary —
    the same whitelist doctrine as the shell's RENDERER_KEYS, kept inside the vault. */
export const VAULT_WRITABLE_KEYS: readonly VaultSettingKey[] = Object.keys(VAULT_DEFAULTS) as VaultSettingKey[];

export function getSetting(db: Db, orgId: string, key: VaultSettingKey): string {
  const row = db
    .prepare("SELECT value FROM vault_settings WHERE org_id = ? AND key = ?")
    .get(orgId, key) as { value: string } | undefined;
  return row?.value ?? VAULT_DEFAULTS[key];
}

export function getNumber(db: Db, orgId: string, key: VaultSettingKey): number {
  const n = Number(getSetting(db, orgId, key));
  return Number.isFinite(n) ? n : Number(VAULT_DEFAULTS[key]);
}

export function getBool(db: Db, orgId: string, key: VaultSettingKey): boolean {
  return getSetting(db, orgId, key) === "1";
}

/** Reads every key — defaults included — so the renderer never has to know the default list. */
export function getAllSettings(db: Db, orgId: string): Record<string, string> {
  const out: Record<string, string> = { ...VAULT_DEFAULTS };
  const rows = db.prepare("SELECT key, value FROM vault_settings WHERE org_id = ?").all(orgId) as {
    key: string;
    value: string;
  }[];
  for (const r of rows) if (r.key in VAULT_DEFAULTS) out[r.key] = r.value;
  return out;
}

/** Upsert. Refuses an unknown key rather than storing junk the readers will never look at. */
export function setSetting(db: Db, orgId: string, key: unknown, value: unknown): void {
  // NAME THE KEY. "Unknown vault setting" with no key sent me through six greps hunting for which
  // one (08-12-2026) — the log had the failure, the reference and the stack, and still could not
  // answer the only question that mattered. A setting key is not a secret; the VALUE never appears.
  if (typeof key !== "string" || !(key in VAULT_DEFAULTS)) {
    throw new Error(`Unknown vault setting: ${typeof key === "string" ? key : typeof key}`);
  }
  // The shortcuts list is a JSON array and legitimately outgrows a scalar's cap; everything else
  // stays tight so a runaway writer is caught at the boundary.
  const max = key === "sidebar.shortcuts" ? 8000 : 500;
  if (typeof value !== "string" || value.length > max) {
    throw new Error(`Invalid value for ${key} — ${typeof value === "string" ? `${value.length} characters, max ${max}` : typeof value}`);
  }
  const at = nowIso();
  db.prepare(
    `INSERT INTO vault_settings (uuid, org_id, key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(generateUUIDv7(), orgId, key, value, at, at);
  // The log floor is cached per connection so a chatty path is not a SELECT per line — dropping the
  // cache HERE is what makes "turn debug on" take effect immediately rather than on next launch.
  if (key === "log.min_level") forgetMinLevel(db);
}

/**
 * INTERNAL key/value pairs that are NOT user preferences and NOT renderer-writable — the lock
 * verifier and its salt, the seed ledger. Same table, deliberately outside VAULT_DEFAULTS so
 * setSetting can never reach them from the bridge.
 */
export function getInternal(db: Db, orgId: string, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM vault_settings WHERE org_id = ? AND key = ?")
    .get(orgId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setInternal(db: Db, orgId: string, key: string, value: string): void {
  const at = nowIso();
  db.prepare(
    `INSERT INTO vault_settings (uuid, org_id, key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(generateUUIDv7(), orgId, key, value, at, at);
}

export function clearInternal(db: Db, orgId: string, key: string): void {
  db.prepare("DELETE FROM vault_settings WHERE org_id = ? AND key = ?").run(orgId, key);
}


// ---------------------------------------------------------------- compaction pressure
/**
 * SHOULD THE VAULT BE COMPACTED RIGHT NOW? Pure arithmetic, extracted from the IPC handler so it can
 * be proven — five interacting conditions is exactly the shape that is quietly wrong on the fourth
 * edge case (Jason 08-12-2026: "calculated, not firing like an idiot").
 *
 * ORDER MATTERS and is deliberate:
 *   1. off        — the user said no.
 *   2. cooldown   — never twice inside ten minutes, whatever else is true. Anti-thrash.
 *   3. absolute   — enough dead space that the rewrite plainly pays for itself.
 *   4. proportional — a quarter of the file is dead, even if that is only a few megabytes.
 *   5. schedule   — the backstop for slow accumulation that never trips a bar.
 * Both bars carry a NEAR band: within 80% is close enough to take now rather than repeat the check
 * in an hour and do the same work then.
 */
export const COMPACT_RATIO_BAR = 0.25;
export const COMPACT_RATIO_FLOOR = 5 * 1048576;
export const COMPACT_NEAR = 0.8;
export const COMPACT_COOLDOWN_MS = 10 * 60 * 1000;

export interface CompactInputs {
  every: string;
  reclaimable: number;
  fileBytes: number;
  absoluteBar: number;
  sinceLastMs: number | null;
}

export interface CompactVerdict {
  compact: boolean;
  reason: "off" | "cooldown" | "below-threshold" | "compacted";
  why?: "absolute" | "proportional" | "schedule";
  ratio: number;
  hitsAbsolute: boolean;
  hitsRatio: boolean;
  hitsSchedule: boolean;
}

export function compactDecision(i: CompactInputs): CompactVerdict {
  const ratio = i.fileBytes > 0 ? i.reclaimable / i.fileBytes : 0;
  const hitsAbsolute = i.reclaimable >= i.absoluteBar * COMPACT_NEAR;
  const hitsRatio = ratio >= COMPACT_RATIO_BAR * COMPACT_NEAR && i.reclaimable >= COMPACT_RATIO_FLOOR;
  // NEVER COMPACTED IS NOT THE SAME AS OVERDUE. Treating a null as "infinitely overdue" made every
  // fresh vault compact on first launch for any 5 MB of slack — which is the reflexive firing the
  // pressure model exists to avoid. Until there is a baseline, the bars decide alone; the first
  // compact (manual or pressure-driven) starts the clock. Caught by notes-proof, not by reading.
  const scheduleDue =
    i.sinceLastMs == null ? false
    : i.every === "off" ? false
    : i.every === "launch" ? true
    : i.every === "daily" ? i.sinceLastMs > 24 * 60 * 60 * 1000
    : i.sinceLastMs > 7 * 24 * 60 * 60 * 1000;
  const hitsSchedule = scheduleDue && i.reclaimable >= COMPACT_RATIO_FLOOR;
  const base = { ratio, hitsAbsolute, hitsRatio, hitsSchedule };

  if (i.every === "off") return { compact: false, reason: "off", ...base };
  // Cooldown outranks every trigger — a vault that somehow stays "bloated" after a compact must not
  // rebuild itself in a loop.
  if (i.sinceLastMs != null && i.sinceLastMs < COMPACT_COOLDOWN_MS) {
    return { compact: false, reason: "cooldown", ...base };
  }
  if (hitsAbsolute) return { compact: true, reason: "compacted", why: "absolute", ...base };
  if (hitsRatio) return { compact: true, reason: "compacted", why: "proportional", ...base };
  if (hitsSchedule) return { compact: true, reason: "compacted", why: "schedule", ...base };
  return { compact: false, reason: "below-threshold", ...base };
}
