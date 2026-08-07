/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// ONE entry detail, shared by the collage and the three-pane view (mockup surface 2's right pane).
// Written once on purpose: two copies of "what an entry looks like" drift, and the one that drifts
// is always the one nobody is looking at.
//
// The discipline that matters here: nothing on this pane holds a credential until the user presses
// Reveal, which calls read() — the single logged path. Hiding drops it from state. The version list
// shows NUMBERS AND DATES ONLY; the service refuses to return a past value at all, so there is no
// second way out even if this component asked for one.
import { useCallback, useEffect, useState } from "react";
import BrandMark from "./BrandMark";
import { shortDate } from "./SecretsView";
import { vaultApi, type VaultSecretExtras, type VaultSecretMeta, type VaultVersionRow } from "./vaultApi";

export interface DetailPaneProps {
  secret: VaultSecretMeta;
  onReload: () => void;
  onEdit: (s: VaultSecretMeta) => void;
  onClose?: () => void;
}

export default function DetailPane({ secret, onReload, onEdit, onClose }: DetailPaneProps) {
  const api = vaultApi();
  const [value, setValue] = useState<string | null>(null);
  const [extras, setExtras] = useState<VaultSecretExtras | null>(null);
  const [versions, setVersions] = useState<VaultVersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Selecting a different entry must forget the last one's credential immediately — not on the
  // next render, not when the component happens to unmount.
  useEffect(() => {
    setValue(null);
    setExtras(null);
    setCopied(false);
    setError(null);
  }, [secret.uuid]);

  useEffect(() => {
    let live = true;
    void api
      .listVersions(secret.uuid)
      .then((v) => {
        if (live) setVersions(v);
      })
      .catch(() => {
        if (live) setVersions([]);
      });
    return () => {
      live = false;
    };
  }, [api, secret.uuid]);

  const reveal = useCallback((): void => {
    setBusy(true);
    setError(null);
    void api
      .read(secret.uuid)
      .then((full) => {
        setValue(full.value);
        setExtras(full.extras);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [api, secret.uuid]);

  const copy = useCallback((): void => {
    setBusy(true);
    setError(null);
    void api
      .read(secret.uuid)
      .then((full) => navigator.clipboard.writeText(full.value))
      .then(() => setCopied(true))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [api, secret.uuid]);

  return (
    <div className="vault-detail">
      <div className="vault-detailhead">
        <BrandMark label={secret.label} size={38} />
        <div style={{ minWidth: 0 }}>
          <h3>{secret.label}</h3>
          {secret.full_name && <div className="vault-who">{secret.full_name}</div>}
        </div>
        <div className="vault-detailacts">
          <button className="vault-btn" onClick={() => onEdit(secret)}>
            Edit
          </button>
          {secret.archived_at ? (
            <button className="vault-btn" onClick={() => void api.restore(secret.uuid).then(onReload)}>
              Restore
            </button>
          ) : (
            <button className="vault-btn danger" onClick={() => void api.archive(secret.uuid, null).then(onReload)}>
              Archive
            </button>
          )}
          {onClose && (
            <button className="vault-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
      </div>

      {error && <div className="vault-state error">{error}</div>}

      <div className="vault-fbox">
        <div className="vault-flabel">Username / ID</div>
        <div className="vault-fvalue">{secret.username ?? <span className="vault-who">Not set</span>}</div>
      </div>

      <div className="vault-fbox">
        <div className="vault-flabel">Password</div>
        <div className="vault-fvalue">
          <span className={value ? "vault-revealed" : "vault-masked"}>{value ?? "••••••••••••"}</span>
          <span className="vault-facts">
            <button className="vault-btn" disabled={busy} onClick={() => (value ? setValue(null) : reveal())}>
              {value ? "Hide" : "Reveal"}
            </button>
            <button className="vault-btn" disabled={busy} onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </span>
        </div>
      </div>

      {secret.url && (
        <div className="vault-fbox">
          <div className="vault-flabel">Website</div>
          <div className="vault-fvalue">{secret.url}</div>
        </div>
      )}

      {/* Backup codes and security answers are credentials — they appear only after a Reveal, in
          the same breath as the password, because they came out of the same logged read. */}
      {value && extras?.backupCodes && extras.backupCodes.length > 0 && (
        <div className="vault-fbox">
          <div className="vault-flabel">Backup codes</div>
          <div className="vault-fvalue vault-revealed">{extras.backupCodes.join("  ·  ")}</div>
        </div>
      )}
      {value && extras?.securityQuestions && extras.securityQuestions.length > 0 && (
        <div className="vault-fbox">
          <div className="vault-flabel">Security questions</div>
          <div className="vault-fvalue" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            {extras.securityQuestions.map((q) => (
              <div key={q.question}>
                <span className="vault-who">{q.question} </span>
                <span className="vault-revealed">{q.answer}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {secret.notes && (
        <div className="vault-fbox">
          <div className="vault-flabel">Notes</div>
          <div className="vault-fvalue" style={{ color: "var(--mc-muted)" }}>{secret.notes}</div>
        </div>
      )}

      <div className="vault-fbox">
        <div className="vault-flabel">Version history — append-only</div>
        <div className="vault-fvalue" style={{ flexDirection: "column", alignItems: "stretch", gap: 5 }}>
          {versions === null ? (
            <span className="vault-who">Reading…</span>
          ) : versions.length === 0 ? (
            <span className="vault-who">No history recorded.</span>
          ) : (
            versions.map((v, i) => (
              <div key={v.version} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                <b className="vault-mono" style={{ color: i === 0 ? "var(--vault-strong-color)" : "var(--mc-dimmer)" }}>
                  v{v.version}
                </b>
                <span className="vault-mono vault-who">{shortDate(v.created_at)}</span>
                <span className="vault-who" style={{ marginLeft: "auto" }}>
                  {i === 0 ? "current" : "superseded"}
                  {v.has_extras ? " · with codes" : ""}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="vault-hint">
        Every reveal and copy on this pane is written to the access log. Older versions are kept but their values are
        never handed back — only the dates above.
      </div>
    </div>
  );
}
