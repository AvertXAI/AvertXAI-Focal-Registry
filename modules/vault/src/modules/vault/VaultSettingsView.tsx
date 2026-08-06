/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Vault settings (mockup surface 8) — and it lives INSIDE the vault on purpose. Canon: the
// application's Settings page carries no vault controls, ever; a vault that can be reconfigured
// from outside itself hands an attacker a lever. Carries the Lock section (the placeholder seam),
// the seed-data card Jason ruled on 08-06, and the storage facts.
import { useCallback, useEffect, useState } from "react";
import { vaultApi, type VaultLockState } from "./vaultApi";

export interface VaultSettingsProps {
  settings: Record<string, string>;
  lockState: VaultLockState | null;
  onSetting: (key: string, value: string) => void;
  onLockChanged: (s: VaultLockState) => void;
  onDataChanged: () => void;
}

export default function VaultSettingsView({ settings, lockState, onSetting, onLockChanged, onDataChanged }: VaultSettingsProps) {
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
      </div>

      {/* ---- Import / export: mapped, not built. Orange is the not-built reference (Jason 08-06). ---- */}
      <div className="vault-card" style={{ borderColor: "var(--mc-orange)" }}>
        <div className="vault-cardhead">
          <span className="vault-cardtitle" style={{ color: "var(--mc-orange)" }}>
            Import / Export
          </span>
          <span className="vault-kind" style={{ color: "var(--mc-orange)", borderColor: "var(--mc-orange)" }}>
            Not built
          </span>
        </div>
        <div className="vault-hint">
          Bringing in a spreadsheet of passwords, and taking one out again. The import maps a file's columns onto vault
          fields and shows exactly what will be created before a single row is written. A plain export is the one action
          that takes secrets out from behind the encryption, so it will always confirm first and always be recorded.
        </div>
      </div>
    </>
  );
}
