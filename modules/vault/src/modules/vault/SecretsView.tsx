/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The stored-secrets ledger (mockup surface 1) and the entry form (surface 7). One table, one
// modal, and the discipline that makes them safe: a row shows METADATA, and a value appears only
// after Reveal — which is a call to read(), which is access-logged main-side. Nothing on this
// screen holds a credential until the user asks for one, and a revealed value is dropped from
// component state the moment the row is hidden again.
import { useCallback, useEffect, useMemo, useState } from "react";
import BrandMark from "./BrandMark";
import { FolderContextMenu, useRowFiling } from "./FolderMenu";
import GeneratorPanel from "./GeneratorPanel";
import { vaultApi, type VaultSecretExtras, type VaultSecretInput, type VaultSecretMeta, type VaultStrength } from "./vaultApi";

const KINDS: [string, string][] = [
  ["login", "Login"],
  ["api_key", "API key"],
  ["financial", "Financial"],
  ["taxpayer_id", "Taxpayer ID"],
  ["note", "Secure note"],
];

function kindLabel(kind: string): string {
  return KINDS.find(([k]) => k === kind)?.[1] ?? kind;
}

/** MM-DD-YYYY, month-first everywhere a human sees it (canon). */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
}

export interface SecretsViewProps {
  secrets: VaultSecretMeta[];
  folders?: import("./vaultApi").VaultFolder[];
  loading: boolean;
  error: boolean;
  filter: string;
  search: string;
  onReload: () => void;
  onNew: () => void;
  onEdit: (s: VaultSecretMeta) => void;
}

// The entry modal is owned by VaultModule, like every other view's — this file used to mount a
// SECOND copy of it, which meant two places to keep in step and two ways to open the same form.
export default function SecretsView({ secrets, folders = [], loading, error, filter, search, onReload, onNew, onEdit }: SecretsViewProps) {
  const api = vaultApi();
  // uuid → the value currently on screen. Deliberately per-row and deliberately cleared on hide:
  // a revealed credential should not outlive the moment the user asked to see it.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  // Drag a row onto a folder in the rail, or right-click it — the dropdown is gone (Jason 08-07).
  const { menu, setMenu, rowProps } = useRowFiling();

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return secrets.filter((s) => {
      if (filter === "favourites" && s.favourite !== 1) return false;
      if (filter === "archived" && !s.archived_at) return false;
      if (filter !== "archived" && s.archived_at) return false;
      if (filter.startsWith("kind:") && s.kind !== filter.slice(5)) return false;
      if (filter === "unfiled" && s.folder_id != null) return false;
      if (filter.startsWith("folder:") && s.folder_id !== Number(filter.slice(7))) return false;
      if (!q) return true;
      return [s.label, s.username, s.url, s.full_name].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [secrets, filter, search]);

  const reveal = useCallback(
    (uuid: string): void => {
      setRowError(null);
      setBusy(uuid);
      void api
        .read(uuid)
        .then((full) => setRevealed((r) => ({ ...r, [uuid]: full.value })))
        .catch((e: unknown) => setRowError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(null));
    },
    [api]
  );

  const hide = (uuid: string): void =>
    setRevealed((r) => {
      const next = { ...r };
      delete next[uuid];
      return next;
    });

  /** Copy goes through the same logged read — the clipboard is a value leaving the vault. */
  const copy = useCallback(
    (uuid: string): void => {
      setRowError(null);
      setBusy(uuid);
      void api
        .read(uuid)
        .then((full) => navigator.clipboard.writeText(full.value))
        .catch((e: unknown) => setRowError(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(null));
    },
    [api]
  );

  if (loading) return <div className="vault-state">Opening the vault…</div>;
  if (error) {
    return (
      <div className="vault-state error">
        The vault could not be read.
        <div>
          <button className="vault-btn" onClick={onReload}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Stored secrets</span>
          <div className="vault-btnrow">
            <button className="vault-btn primary" onClick={onNew}>
              + New entry
            </button>
          </div>
        </div>
        {rowError && <div className="vault-state error">{rowError}</div>}
        {rows.length === 0 ? (
          <div className="vault-state">
            {secrets.length === 0
              ? "Nothing is stored in the vault yet."
              : "No entry matches that filter."}
          </div>
        ) : (
          <table className="vault-table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Label</th>
                <th>Username</th>
                <th>Kind</th>
                <th>Value</th>
                <th style={{ width: 44 }}>Ver</th>
                <th>Last read</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const shown = revealed[s.uuid];
                return (
                  <tr key={s.uuid} {...rowProps(s.uuid, s.label)}>
                    <td>
                      <button
                        className={`vault-star${s.favourite === 1 ? " on" : ""}`}
                        title={s.favourite === 1 ? "Remove from favourites" : "Add to favourites"}
                        onClick={() => void api.setFavourite(s.uuid, s.favourite !== 1).then(onReload)}
                      >
                        {s.favourite === 1 ? "★" : "☆"}
                      </button>
                    </td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <BrandMark label={s.label} size={26} />
                        <span style={{ minWidth: 0 }}>
                          <b>{s.label}</b>
                          {s.url && <div className="vault-who">{s.url}</div>}
                        </span>
                      </span>
                    </td>
                    <td>{s.username ?? <span className="vault-who">—</span>}</td>
                    <td>
                      <span className="vault-kind">{kindLabel(s.kind)}</span>
                    </td>
                    <td>
                      {shown ? <span className="vault-revealed">{shown}</span> : <span className="vault-masked">••••••••••</span>}
                    </td>
                    <td className="vault-mono">{s.version}</td>
                    <td className="vault-who">{s.last_read_at ? shortDate(s.last_read_at) : "Never read"}</td>
                    <td>
                      <div className="vault-acts">
                        <button className="vault-btn" disabled={busy === s.uuid} onClick={() => (shown ? hide(s.uuid) : reveal(s.uuid))}>
                          {shown ? "Hide" : "Reveal"}
                        </button>
                        <button className="vault-btn" disabled={busy === s.uuid} onClick={() => copy(s.uuid)}>
                          Copy
                        </button>
                        <button className="vault-btn" onClick={() => onEdit(s)}>
                          Edit
                        </button>
                        {s.archived_at ? (
                          <button className="vault-btn" onClick={() => void api.restore(s.uuid).then(onReload)}>
                            Restore
                          </button>
                        ) : (
                          <button className="vault-btn danger" onClick={() => void api.archive(s.uuid, null).then(onReload)}>
                            Archive
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {menu && (
        <FolderContextMenu
          state={menu}
          folders={folders}
          onPick={(uuid, folderId) => {
            setMenu(null);
            void api.updateMeta(uuid, { folderId }).then(onReload).catch(() => undefined);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

/**
 * The entry form (mockup surface 7). Creating writes version 1; editing an EXISTING entry saves
 * metadata and — only if the value box was actually touched — supersedes, which appends a version
 * rather than overwriting one. The form never pre-fills the existing password: showing it would be
 * an unlogged reveal, and the user did not ask to see it.
 */
export function EntryModal({
  secret,
  settings,
  onSetting,
  onClose,
  onSaved,
}: {
  secret: VaultSecretMeta | null;
  settings: Record<string, string>;
  onSetting: (k: string, v: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = vaultApi();
  const [form, setForm] = useState<VaultSecretInput>({
    kind: secret?.kind ?? "login",
    label: secret?.label ?? "",
    value: "",
    fullName: secret?.full_name ?? "",
    username: secret?.username ?? "",
    url: secret?.url ?? "",
    notes: secret?.notes ?? "",
  });
  const [codes, setCodes] = useState("");
  const [questions, setQuestions] = useState("");
  const [strength, setStrength] = useState<VaultStrength | null>(null);
  const [showValue, setShowValue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ESCAPE CLOSES IT (Jason 08-07-2026). Standing rule for every modal in this module: a dialog
  // you cannot dismiss from the keyboard is a trap, and the mouse is not always the fast way out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof VaultSecretInput>(k: K, v: VaultSecretInput[K]): void =>
    setForm((f) => ({ ...f, [k]: v }));

  // Strength is scored main-side so the estimator has one home; the box is not a credential store.
  useEffect(() => {
    if (!form.value) {
      setStrength(null);
      return;
    }
    let live = true;
    void api.strength(form.value).then((s) => {
      if (live) setStrength(s);
    });
    return () => {
      live = false;
    };
  }, [api, form.value]);

  const buildExtras = (): VaultSecretExtras | null => {
    const backupCodes = codes.split(/[\n,]/).map((c) => c.trim()).filter(Boolean);
    const securityQuestions = questions
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf("?");
        return at === -1 ? { question: line, answer: "" } : { question: line.slice(0, at + 1), answer: line.slice(at + 1).trim() };
      });
    return backupCodes.length || securityQuestions.length ? { backupCodes, securityQuestions } : null;
  };

  const save = (): void => {
    setError(null);
    setSaving(true);
    const extras = buildExtras();
    const done = (): void => {
      setSaving(false);
      onSaved();
    };
    const fail = (e: unknown): void => {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    };
    if (!secret) {
      void api.create({ ...form, extras }).then(done).catch(fail);
      return;
    }
    // An existing entry: metadata always, credential only when one was typed.
    void api
      .updateMeta(secret.uuid, {
        kind: form.kind,
        label: form.label,
        fullName: form.fullName,
        username: form.username,
        url: form.url,
        notes: form.notes,
      })
      .then(() => (form.value ? api.supersede(secret.uuid, form.value, extras) : Promise.resolve(null)))
      .then(done)
      .catch(fail);
  };

  return (
    <div className="vault-modalback" onClick={onClose}>
      <div className="vault-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{secret ? "Edit entry" : "New entry"}</h3>
        <div className="vault-modalsub">
          {secret
            ? `Version ${secret.version} — saving a new value appends version ${secret.version + 1}; the old one is kept.`
            : "The value is written to the encrypted vault as version 1 and only leaves it through a read you can see in the access log."}
        </div>

        <div className="vault-two">
          <div className="vault-field">
            <label htmlFor="v-label">Company / name</label>
            <input id="v-label" value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="Hetzner" />
          </div>
          <div className="vault-field">
            <label htmlFor="v-kind">Kind</label>
            <select id="v-kind" value={form.kind} onChange={(e) => set("kind", e.target.value)}>
              {KINDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="vault-two">
          <div className="vault-field">
            <label htmlFor="v-full">Full name</label>
            <input id="v-full" value={form.fullName ?? ""} onChange={(e) => set("fullName", e.target.value)} placeholder="Paul Cruz" />
          </div>
          <div className="vault-field">
            <label htmlFor="v-user">Username / ID</label>
            <input id="v-user" value={form.username ?? ""} onChange={(e) => set("username", e.target.value)} placeholder="paul@example.com" />
          </div>
        </div>

        <div className="vault-field">
          <label htmlFor="v-value">{secret ? "New value — leave empty to keep the current one" : "Value"}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="v-value"
              type={showValue ? "text" : "password"}
              value={form.value}
              onChange={(e) => set("value", e.target.value)}
              autoComplete="new-password"
            />
            <button className="vault-btn" type="button" onClick={() => setShowValue((s) => !s)}>
              {showValue ? "Hide" : "Show"}
            </button>
          </div>
          {/* THE WHOLE GENERATOR, IN THE FORM (Jason 08-07-2026) — every mode, every option, the
              same component the Generator tab renders. The two-lever miniature that used to sit
              here was a second generator in all but name, and it was already the weaker one. */}
          <div className="vault-inlinegen">
            <GeneratorPanel
              settings={settings}
              onSetting={onSetting}
              onUse={(v) => {
                set("value", v);
                setShowValue(true);
              }}
            />
          </div>
          {strength && (
            <>
              <div className="vault-meter">
                {[0, 1, 2, 3, 4].map((i) => (
                  <i key={i} className={i <= strength.level ? (strength.level <= 1 ? "bad" : strength.level === 2 ? "warn" : "on") : ""} />
                ))}
              </div>
              <div className="vault-strengthrow">
                <span style={{ fontWeight: 600 }}>{strength.label}</span>
                <span className="vault-hint">About {strength.crackTime} to crack — a rough guide, not a promise.</span>
              </div>
            </>
          )}
        </div>

        <div className="vault-field">
          <label htmlFor="v-url">Website</label>
          <input id="v-url" value={form.url ?? ""} onChange={(e) => set("url", e.target.value)} placeholder="console.hetzner.cloud" />
        </div>

        <div className="vault-two">
          <div className="vault-field">
            <label htmlFor="v-codes">Backup codes — one per line</label>
            <textarea id="v-codes" value={codes} onChange={(e) => setCodes(e.target.value)} placeholder="4829-1730" />
          </div>
          <div className="vault-field">
            <label htmlFor="v-q">Security questions — one per line</label>
            <textarea id="v-q" value={questions} onChange={(e) => setQuestions(e.target.value)} placeholder="First pet? Maggie" />
          </div>
        </div>

        <div className="vault-field">
          <label htmlFor="v-notes">Notes</label>
          <textarea id="v-notes" value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </div>

        <div className="vault-hint">
          Backup codes and security answers are stored exactly like the password — encrypted, versioned with it, and
          returned only by an entry you open yourself.
        </div>

        {error && <div className="vault-state error">{error}</div>}
        <div className="vault-modalacts">
          <button className="vault-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="vault-btn primary" disabled={saving || !form.label || (!secret && !form.value)} onClick={save}>
            {saving ? "Saving…" : secret ? "Save changes" : "Save entry"}
          </button>
        </div>
      </div>
    </div>
  );
}
