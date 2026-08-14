/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Vault settings (mockup surface 8) — and it lives INSIDE the vault on purpose. Canon: the
// application's Settings page carries no vault controls, ever; a vault that can be reconfigured
// from outside itself hands an attacker a lever. Carries the Lock section (the placeholder seam),
// the seed-data card Jason ruled on 08-06, and the storage facts.
import { useCallback, useEffect, useState } from "react";
import CodeAppearance from "./CodeAppearance";
import SidebarEditor from "./SidebarEditor";
import type { Shortcut } from "./Sidebar";
import { vaultApi, type VaultCompactStatus, type VaultFolder, type VaultLockState, type VaultSecretMeta } from "./vaultApi";

export interface VaultSettingsProps {
  settings: Record<string, string>;
  lockState: VaultLockState | null;
  onSetting: (key: string, value: string) => void;
  onLockChanged: (s: VaultLockState) => void;
  onDataChanged: () => void;
  /** The sidebar editor (Jason 08-10-2026) — arranging lives here; quick-add lives on the sidebar. */
  shortcuts: Shortcut[];
  onShortcuts: (list: Shortcut[]) => void;
  secrets: VaultSecretMeta[];
  folders: VaultFolder[];
}

export default function VaultSettingsView({ settings, lockState, onSetting, onLockChanged, onDataChanged, shortcuts, onShortcuts, secrets, folders }: VaultSettingsProps) {
  const api = vaultApi();
  const [seed, setSeed] = useState<{ present: boolean; count: number } | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const loadSeedStatus = useCallback((): void => {
    void api.seedStatus().then(setSeed).catch(() => setSeed(null));
  }, [api]);

  useEffect(() => {
    loadSeedStatus();
  }, [loadSeedStatus]);

  const runSeed = (which: "load" | "purge"): void => {
    setSeedBusy(true);
    setSeedMessage(null);
    setSeedError(null);
    // Branched rather than shared, so each result keeps its own shape — a seed result and a purge
    // result are different answers and the compiler is right to refuse to merge them.
    const call: Promise<{ ok: boolean; error?: string; message?: string }> =
      which === "load"
        ? api.loadSeed().then((r) => ({
            ok: r.ok,
            error: r.error,
            message: `Loaded ${r.created ?? 0} entries — ${r.superseded ?? 0} of them with a rotation already on record.`,
          }))
        : api.purgeSeed().then((r) => ({
            ok: r.ok,
            error: r.error,
            message: `Removed ${r.removed ?? 0} seeded entries. Anything you created yourself is untouched.`,
          }));
    void call
      .then((r) => {
        if (!r.ok) {
          setSeedError(r.error ?? "That did not work.");
          return;
        }
        setSeedMessage(r.message ?? null);
        loadSeedStatus();
        onDataChanged();
      })
      .catch((e: unknown) => setSeedError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSeedBusy(false));
  };

  const changePassword = (): void => {
    setPwMessage(null);
    setPwError(null);
    void api
      .changeMasterPassword(pwCurrent, pwNext)
      .then((s) => {
        onLockChanged(s);
        setPwCurrent("");
        setPwNext("");
        setPwMessage("The master password has been changed.");
      })
      .catch((e: unknown) => setPwError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <>
      {/* The sidebar editor sits FIRST — it is the settings surface most likely to be wanted, and
          the one Jason asked for by name (08-10-2026). */}
      <SidebarEditor
        shortcuts={shortcuts} onChange={onShortcuts} secrets={secrets} folders={folders}
        adjustable={settings["sidebar.width_adjustable"] !== "0"}
        onAdjustable={(v) => onSetting("sidebar.width_adjustable", v ? "1" : "0")}
      />

      {/* Second, beside the sidebar editor, because both are presentation and this is the one Jason
          went looking for and could not find: "where do i select my colors?" (08-13-2026). */}
      <CodeAppearance settings={settings} onSetting={onSetting} />

      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">These settings live inside the Vault only</span>
        </div>
        <div className="vault-hint">
          Nothing here is reachable from the application's own Settings page. A vault that can be reconfigured from
          outside itself gives an attacker a lever — the lock, the seed data and the master password are changed in here
          or not at all.
        </div>
      </div>

      {/* ---- Lock. The placeholder seam, described honestly. ---- */}
      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Lock</span>
        </div>
        <div className="vault-opts">
          <label className="vault-opt">
            <input
              type="checkbox"
              checked={settings["lock.enabled"] !== "0"}
              onChange={(e) => onSetting("lock.enabled", e.target.checked ? "1" : "0")}
            />
            Require the master password to open the vault
          </label>
          <div className="vault-opt">
            <span style={{ minWidth: 120 }}>Lock automatically after</span>
            <select
              value={settings["lock.auto_minutes"] ?? "0"}
              onChange={(e) => onSetting("lock.auto_minutes", e.target.value)}
              style={{ background: "var(--mc-field)", border: "1px solid var(--mc-border)", borderRadius: 8, padding: "6px 10px", color: "var(--mc-text)" }}
            >
              <option value="0">Never</option>
              <option value="5">5 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
            </select>
          </div>
          <div className="vault-opt">
            <span style={{ minWidth: 120 }}>Clear a copied value after</span>
            <select
              value={settings["clipboard.clear_seconds"] ?? "30"}
              onChange={(e) => onSetting("clipboard.clear_seconds", e.target.value)}
              style={{ background: "var(--mc-field)", border: "1px solid var(--mc-border)", borderRadius: 8, padding: "6px 10px", color: "var(--mc-text)" }}
            >
              <option value="0">Never</option>
              <option value="15">15 seconds</option>
              <option value="30">30 seconds</option>
              <option value="60">1 minute</option>
            </select>
          </div>
        </div>
        <div className="vault-hint" style={{ marginTop: 14 }}>
          <b>What this lock does and does not do.</b> It protects this screen and the channels behind it, so someone at
          your keyboard cannot read your secrets. It does <b>not</b> encrypt anything — the vault file is already
          encrypted and still opens automatically from the operating system's credential store. Making the master
          password part of that encryption is the next step, and it is not built yet.
        </div>
      </div>

      {/* ---- Master password ---- */}
      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Master password</span>
          {lockState && <span className="vault-hint">{lockState.enabled ? "Required" : "Turned off"}</span>}
        </div>
        <div className="vault-two">
          <div className="vault-field">
            <label htmlFor="pw-cur">Current password</label>
            <input id="pw-cur" type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="vault-field">
            <label htmlFor="pw-next">New password — at least 8 characters</label>
            <input id="pw-next" type="password" value={pwNext} onChange={(e) => setPwNext(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        {pwError && <div className="vault-state error">{pwError}</div>}
        {pwMessage && <div className="vault-hint">{pwMessage}</div>}
        <div className="vault-btnrow" style={{ marginTop: 10 }}>
          <button className="vault-btn primary" disabled={!pwCurrent || pwNext.length < 8} onClick={changePassword}>
            Change master password
          </button>
        </div>
      </div>

      {/* ---- Seed data (Jason's ruling, 08-06-2026) ---- */}
      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Seed data</span>
          <span className="vault-hint">
            {seed?.present ? `${seed.count} seeded entries are loaded` : "No seed data loaded"}
          </span>
        </div>
        <div className="vault-hint">
          Loads the sample workbook — forty-six made-up logins with deliberately poor passwords, so every screen has
          something real to show and the health check has honest work to do. Every value is fake. Purging removes
          exactly what was loaded and nothing you created yourself.
        </div>
        {seedError && <div className="vault-state error">{seedError}</div>}
        {seedMessage && (
          <div className="vault-hint" style={{ marginTop: 8, color: "var(--vault-strong-color)" }}>
            {seedMessage}
          </div>
        )}
        <div className="vault-btnrow" style={{ marginTop: 12 }}>
          <button className="vault-btn primary" disabled={seedBusy || seed?.present === true} onClick={() => runSeed("load")}>
            {seedBusy ? "Working…" : "Load seed data"}
          </button>
          <button className="vault-btn danger" disabled={seedBusy || seed?.present !== true} onClick={() => runSeed("purge")}>
            Purge seed data
          </button>
        </div>
      </div>

      {/* ---- Storage facts ---- */}
      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Storage</span>
        </div>
        <div className="vault-hint">
          The vault keeps its own encrypted database, separate from everything else the application stores. Both of its
          files are named so they say nothing about what they hold. That is not protection in itself — the encryption
          is — it just removes the invitation.
        </div>
        <Compactor settings={settings} onSetting={onSetting} />
        <NotePurge onDone={onDataChanged} />
      </div>

      {/* The event log MOVED to its own surface on 08-12-2026 — it is reached from the ⚠ chip in the
          nav row and from Diagnostics in this sidebar. A copy here would be a second place to look. */}
    </>
  );
}

/**
 * THE EVENT LOG SURFACE. Jason, 08-11-2026: "when something breaks, the app spits out an error only
 * I would understand… not a normal oh shit something broke contact the developer to the user."
 *
 * So the split is: the user gets a sentence and a REFERENCE; this screen is where the reference is
 * cashed in. Paste VLT-A3F91C into the search box and the technical row it names comes back with
 * its stack. That is the entire design, and the reason request_id exists as a column.
 *
 * The level chooser writes log.min_level, which is the FLOOR FOR WHAT IS KEPT, not a view filter —
 * dropping it to Debug starts recording developer chatter from that moment. Said plainly on screen,
 * because a filter that silently changes what the past looks like would be a trap.
 */


/**
 * COMPACT THE VAULT. SQLite does not hand deleted space back to the operating system on its own —
 * freed pages are reused by later writes, so the file stays as large as it ever was until it is
 * rebuilt. Measured 08-12-2026 on a 76 MB vault: 1,849 deleted notes freed nothing until a compact,
 * which returned it to 7.4 MB in 167 ms.
 *
 * WHY THIS IS A BUTTON AND NOT AUTOMATIC. Jason asked whether it could just run on every delete. It
 * was measured rather than argued: a full rebuild after ONE delete cost 2,158 ms and reclaimed
 * nothing. Deletes now do the cheap incremental reclaim instead (0 ms), and this is the occasional
 * full tidy — which also converts a pre-existing file to incremental mode, so it only ever needs
 * pressing once before deletes start maintaining themselves.
 */
function Compactor({ settings, onSetting }: { settings: Record<string, string>; onSetting: (k: string, v: string) => void }) {
  const api = vaultApi();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [st, setSt] = useState<VaultCompactStatus | null>(null);
  const mb = (b: number): string => `${(b / 1048576).toFixed(1)} MB`;

  /** Dry run — the arithmetic, compacting nothing. Shown so the decision is inspectable rather
      than a thing that happens to you. */
  const refresh = useCallback((): void => {
    void api.compactIfDue(true).then(setSt).catch(() => setSt(null));
  }, [api]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = (): void => {
    setBusy(true); setMsg(null); setError(null);
    void api.compact()
      .then((r) => setMsg(
        r.freed > 0
          ? `Compacted — ${mb(r.before)} down to ${mb(r.after)}, ${mb(r.freed)} returned to Windows.`
          : `Already compact at ${mb(r.after)} — there was no reclaimable space.`
      ))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { setBusy(false); refresh(); });
  };

  const pct = st ? Math.round(st.ratio * 100) : 0;

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--mc-border)", paddingTop: 12 }}>
      <div className="vault-btnrow" style={{ alignItems: "center" }}>
        <button className="vault-btn" disabled={busy} onClick={run}>
          {busy && <span className="vault-spinner" aria-hidden="true" />}
          {busy ? "Compacting…" : "Compact the vault"}
        </button>
        <span className="vault-hint" style={{ flex: 1 }}>
          Rebuilds the database file so space from deleted items goes back to Windows. Nothing is lost — it is the same
          data in a tighter file. It needs about double the vault&rsquo;s size in free space while it runs.
        </span>
      </div>
      {/* A rebuild of a 158 MB encrypted file is not instant, and a dead button is how people press
          it twice. The bar is indeterminate on purpose — SQLite reports no progress from VACUUM. */}
      {busy && <div className="vault-progress" role="status" aria-live="polite"><i /></div>}
      {msg && <div className="vault-hint" style={{ marginTop: 8, color: "var(--vault-strong-color)" }}>{msg}</div>}
      {error && <div className="vault-state error" style={{ marginTop: 8 }}>{error}</div>}

      <div className="vault-field" style={{ marginTop: 12, maxWidth: 320 }}>
        <label htmlFor="compact-every">Compact on its own</label>
        <select
          id="compact-every"
          value={settings["maintenance.compact_every"] ?? "weekly"}
          onChange={(e) => onSetting("maintenance.compact_every", e.target.value)}
        >
          <option value="off">Never — I will press the button</option>
          <option value="launch">Every time the vault opens</option>
          <option value="daily">Once a day</option>
          <option value="weekly">Once a week</option>
        </select>
      </div>
      <div className="vault-hint" style={{ marginTop: 6 }}>
        The schedule is only a <b>backstop</b>. What actually triggers it is <b>pressure</b> — dead space left behind by
        deletes — so a bloated vault is tidied straight away instead of waiting for the calendar, and a healthy one is
        never rewritten for nothing. You get a brief green notice when it runs.
      </div>

      {/* THE ARITHMETIC, ON SCREEN. Jason's ask was that it be "calculated, not firing like an
          idiot" — so the calculation is visible rather than something that happens to you. */}
      {st && (
        <div className="vault-card" style={{ marginTop: 12, background: "var(--mc-nested)" }}>
          <div className="vault-cardhead"><span className="vault-cardtitle">Where it stands right now</span></div>
          <div className="vault-pressure">
            {/* AN EMPTY BAR READS AS BROKEN (Jason 08-12-2026 — "shows blank after compacting").
                Zero dead space is the HEALTHY answer, not a missing value, so at 0% the bar fills
                green and says so rather than sitting empty and looking like a failed render. */}
            <div className={`vault-pbar${st.reclaimable === 0 ? " clean" : ""}`}>
              <i style={{ width: st.reclaimable === 0 ? "100%" : `${Math.max(2, Math.min(100, pct))}%` }} />
            </div>
            <div className="vault-hint" style={{ marginTop: 7 }}>
              {st.reclaimable === 0 ? (
                <><b style={{ color: "var(--vault-strong-color)" }}>No dead space at all.</b> All {mb(st.fileBytes)} is live data — there is nothing to reclaim.</>
              ) : (
                <><b>{mb(st.reclaimable)}</b> of <b>{mb(st.fileBytes)}</b> is dead space — <b>{pct}%</b>.</>
              )}
            </div>
          </div>
          <ul className="vault-reasons" style={{ marginTop: 8 }}>
            <li>{st.hitsAbsolute ? "✓" : "—"} Enough on its own: {mb(st.absoluteBar)} reclaimable</li>
            <li>{st.hitsRatio ? "✓" : "—"} Proportionally bloated: {Math.round(st.ratioBar * 100)}% of the file</li>
            <li>{st.hitsSchedule ? "✓" : "—"} Backstop: the {st.every} schedule is due</li>
          </ul>
          <div className="vault-hint" style={{ marginTop: 8 }}>
            {st.hitsAbsolute || st.hitsRatio || st.hitsSchedule
              ? "It will compact on the next check."
              : "Nothing to do — it will leave the file alone."}
            {st.lastCompactedMs ? ` Last compacted ${new Date(st.lastCompactedMs).toLocaleString()}.` : " It has never needed compacting."}
          </div>
        </div>
      )}
    </div>
  );
}


/**
 * CLEAR EVERY NOTE. A testing surface and a real one — after a bad import you want the whole thing
 * gone, and 4,000 archive-then-destroy round trips is not an answer (Jason 08-12-2026: "you didnt
 * create a place for me to purge the notes db").
 *
 * TYPED CONFIRMATION, not a button. This is the most destructive control in the module: it does not
 * archive, there is no shelf to recover from, and it takes the folder tree with it. A dialog you can
 * dismiss by reflex is the wrong guard for that, so the word has to be typed — the same treatment
 * the shell gives its organisation reset.
 */
function NotePurge({ onDone }: { onDone: () => void }) {
  const api = vaultApi();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (): void => {
    setBusy(true); setError(null);
    void api.purgeNotes()
      .then((r) => {
        setMsg(`${r.notes.toLocaleString()} notes and ${r.folders} folders deleted. Passwords, servers and repos are untouched.`);
        setOpen(false); setTyped(""); onDone();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--mc-border)", paddingTop: 12 }}>
      <div className="vault-btnrow" style={{ alignItems: "center" }}>
        <button className="vault-btn danger" onClick={() => setOpen((v) => !v)}>Delete every note</button>
        <span className="vault-hint" style={{ flex: 1 }}>
          Clears all Secured Notes, Runbooks, Ideas <b>and the folder tree</b>. Passwords, servers and repos are not
          touched. Files on your disk are not touched — the vault only ever held copies.
        </span>
      </div>

      {open && (
        <div className="vault-card" style={{ marginTop: 10, borderColor: "var(--vault-danger-color)" }}>
          <div className="vault-hint" style={{ marginBottom: 8 }}>
            <b style={{ color: "var(--vault-danger-color)" }}>There is no undo and no archive.</b> Type
            <b> DELETE</b> to confirm.
          </div>
          <div className="vault-btnrow">
            <input
              className="vault-logsearch" style={{ maxWidth: 200 }} autoFocus value={typed}
              placeholder="DELETE" onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && typed === "DELETE") run(); }}
            />
            <button className="vault-btn danger solid" disabled={typed !== "DELETE" || busy} onClick={run}>
              {busy ? "Deleting…" : "Delete every note"}
            </button>
            <button className="vault-btn" onClick={() => { setOpen(false); setTyped(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {msg && <div className="vault-hint" style={{ marginTop: 8, color: "var(--vault-strong-color)" }}>{msg}</div>}
      {error && <div className="vault-state error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
