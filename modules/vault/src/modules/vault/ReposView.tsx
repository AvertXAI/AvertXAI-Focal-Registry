/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Repos — rows that drop open into the repository. The package ledger USED to share this tab
// (08-10-2026) and moved to Infrastructure on 08-11-2026; see PackageLedger.tsx for why.
//
// The accordion's orange strip is the part GitHub cannot give you: the deploy key and token sitting
// WITH the repo they belong to, as locators resolved through the logged read. That is also the
// reason this surface stays in the Vault while the ONLINE reader goes to MindMerge — a deploy key
// is a credential, and credentials do not leave the vault.
//
// THE README IS A STORED SNAPSHOT AND THIS FILE NEVER FETCHES IT. Jason ruled on 08-11-2026 that
// reading a repository from a URL belongs to MindMerge, which is agent-readable and may reach the
// network; the Vault keeps its no-network property intact.
import { useCallback, useEffect, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import Loading from "./Loading";
import { Markdown } from "./markdown";
import { vaultApi, type VaultRepo, type VaultSecretMeta } from "./vaultApi";

/* The generic document Import was REMOVED here (Jason 08-12-2026): it imported READMEs as notes,
   which is not what this tab is for. Scan a folder and + Add repo are the two real entry points. */
export default function ReposView({ secrets }: { secrets: VaultSecretMeta[] }) {
  const api = vaultApi();
  const [repos, setRepos] = useState<VaultRepo[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);


  const load = useCallback((): void => {
    void api.listRepos().then((r) => { setRepos(r); if (r[0] && open === null) setOpen(r[0].uuid); }).catch(() => setError("Repos could not be read."));
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  /**
   * FIND THE CLONES ALREADY ON THIS DRIVE (Jason 08-11-2026 — "i want to know what I have locally").
   * Filesystem only: it walks for .git folders and reads .git/config for the remote, so both origin
   * icons can be honest with the network off. Rescanning updates rather than duplicating — rows are
   * matched on local_path, and nothing a human typed is overwritten with a blank.
   */
  const scan = useCallback((): void => {
    setScanMsg(null);
    void api.chooseScanRoot()
      .then((root) => {
        if (!root) return; // cancelled — say nothing, change nothing
        setScanning(true);
        return api.scanLocalRepos(root).then((r) => {
          if (r.found.length === 0) {
            setScanMsg(`No git clones found under ${root}. It looks three folders deep and skips node_modules.`);
            return;
          }
          return api.importLocalRepos(r.found).then((res) => {
            setScanMsg(`${r.found.length} found under ${root} — ${res.added} added, ${res.updated} already known and refreshed.`);
            load();
          });
        });
      })
      .catch((e: unknown) => setScanMsg(e instanceof Error ? e.message : String(e)))
      .finally(() => setScanning(false));
  }, [api, load]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* ONE THING ON THIS TAB NOW. The Package ledger moved to Infrastructure (Jason 08-11-2026),
          which leaves Repos with nothing to switch between — so the segment control went with it
          rather than sitting there with a single button in it. */}
      <div className="vault-modeswitch">
        {/* Counts of what the origin icons are saying, so the pair has a legend without needing one. */}
        {repos && repos.length > 0 && (
          <>
            <span className="vault-kind ok">{repos.filter((r) => r.local_path).length} local</span>
            <span className="vault-kind">{repos.filter((r) => r.remote_url).length} with a remote</span>
          </>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="vault-btn" disabled={scanning} onClick={scan}>
            {scanning ? "Scanning…" : "⭳ Scan a folder"}
          </button>
          <button className="vault-btn primary" onClick={() => setAdding(true)}>+ Add repo</button>
        </span>
      </div>
      {scanMsg && <div className="vault-hint" style={{ margin: "0 0 10px" }}>{scanMsg}</div>}
      {error && <div className="vault-state error">{error}</div>}

      {repos === null ? <Loading message="Loading your repos…" />
        : repos.length === 0 ? (
          <div className="vault-state">No repos yet.<div><button className="vault-btn primary" onClick={() => setAdding(true)}>Add the first one</button></div></div>
        ) : (
          repos.map((r) => (
            <RepoRow key={r.uuid} repo={r} secrets={secrets} open={open === r.uuid}
              onToggle={() => setOpen(open === r.uuid ? null : r.uuid)}
              onChanged={load} />
          ))
        )}

      {adding && <RepoModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} secrets={secrets} />}
    </>
  );
}

/**
 * WHERE THIS REPO LIVES — both facts at once (Jason 08-11-2026).
 *
 * BOTH ICONS ARE ALWAYS DRAWN, one lit and one greyed, rather than showing only what is true. A row
 * that renders a single globe leaves you working out whether the missing database icon means "not
 * cloned" or "we did not check". Two icons, always, answers both halves without being read.
 *
 * The globe means A REMOTE IS RECORDED, not "we fetched it" — the Vault never reaches the network
 * (reading a repo is MindMerge's job). `.git/config` gives us the remote locally, which is how this
 * pair can be honest with the network off.
 */
function OriginPair({ local, online }: { local: boolean; online: boolean }) {
  const title = local && online ? "On this drive and has a remote"
    : local ? "On this drive only — no remote recorded"
    : online ? "Remote only — not cloned on this machine"
    : "Neither a local path nor a remote is recorded";
  return (
    <span className="vault-origin" title={title} aria-label={title}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={local ? "on" : "off"} aria-hidden="true">
        <ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={online ? "on" : "off"} aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.8 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.8-3.8-9S9.5 5.7 12 3z" />
      </svg>
    </span>
  );
}

function RepoRow({ repo, secrets, open, onToggle, onChanged }: { repo: VaultRepo; secrets: VaultSecretMeta[]; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const api = vaultApi();
  const key = secrets.find((s) => s.uuid === repo.deploy_secret_uuid);
  const [ask, setAsk] = useState(false);
  return (
    <div className={`vault-repo${open ? " open" : ""}`}>
      <button className="vault-repohead" onClick={onToggle}>
        <OriginPair local={Boolean(repo.local_path)} online={Boolean(repo.remote_url)} />
        <span className="vault-rav" style={{ background: "var(--mc-nested)", color: "var(--mc-text)" }}>{repo.name.slice(0, 2).toUpperCase()}</span>
        <span className="vault-rmeta">
          <span className="vault-rtitle">{repo.name}
            {repo.visibility && <span className="vault-kind">{repo.visibility}</span>}
            {repo.license && <span className={`vault-kind${/GPL|AGPL|SSPL/i.test(repo.license) ? " danger" : ""}`}>{repo.license}</span>}
          </span>
          {repo.description && <span className="vault-rdesc">{repo.description}</span>}
        </span>
        <span className="vault-rstats">
          {repo.language && <span>{repo.language}</span>}
          {repo.stars && <span>★ {repo.stars}</span>}
          {repo.version && <span className="vault-mono">{repo.version}</span>}
        </span>
        <span className="vault-rcar">▶</span>
      </button>
      {open && (
        <div className="vault-repobody">
          <div className="vault-vstrip">
            {key ? <span className="vault-chip"><span className="lk">🔑 {key.label}</span></span> : <span className="vault-who">no deploy key linked</span>}
            {repo.local_path && <span className="vault-mono vault-who">{repo.local_path}</span>}
            {repo.remote_url && <button className="vault-btn sm" onClick={() => window.open(repo.remote_url ?? "", "_blank", "noopener")}>Open on GitHub</button>}
            <button className="vault-btn sm danger" style={{ marginLeft: "auto" }} onClick={() => setAsk(true)}>
              Remove
            </button>
          </div>
          <div className="vault-readme">
            {repo.readme_md ? <Markdown body={repo.readme_md} secrets={secrets} />
              : <div className="vault-state">No README snapshot stored. Paste one when you add or edit this repo — it then reads with the network off.</div>}
          </div>
        </div>
      )}
      {ask && (
        <ConfirmModal
          title={`Remove ${repo.name} from the vault?`}
          body={
            <>
              <p>The row and its stored README snapshot are removed from the vault.</p>
              <p className="vault-hint"><b>The repository itself is untouched</b> — nothing on disk and nothing on GitHub changes. The deploy key it points at stays in the vault too.</p>
            </>
          }
          confirmLabel="Remove"
          danger
          onConfirm={() => void api.deleteRepo(repo.uuid).then(onChanged)}
          onClose={() => setAsk(false)}
        />
      )}
    </div>
  );
}

function RepoModal({ onClose, onSaved, secrets }: { onClose: () => void; onSaved: () => void; secrets: VaultSecretMeta[] }) {
  const api = vaultApi();
  const [f, setF] = useState({ name: "", description: "", visibility: "private", language: "", license: "", stars: "", version: "", localPath: "", remoteUrl: "", deploySecretUuid: "", readmeMd: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string): void => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="vault-modalback" onClick={onClose}>
      <div className="vault-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add a repo</h3>
        <div className="vault-modalsub">Metadata plus a pasted README. The vault never reaches out to GitHub — the snapshot is what makes it readable offline.</div>
        <div className="vault-two">
          <div className="vault-field"><label>Name</label><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="world-monitor" /></div>
          <div className="vault-field"><label>Visibility</label><select value={f.visibility} onChange={(e) => set("visibility", e.target.value)}><option value="private">private</option><option value="public">public</option></select></div>
        </div>
        <div className="vault-field"><label>Description</label><input value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
        <div className="vault-two">
          <div className="vault-field"><label>Language</label><input value={f.language} onChange={(e) => set("language", e.target.value)} placeholder="TypeScript" /></div>
          <div className="vault-field"><label>Licence</label><input value={f.license} onChange={(e) => set("license", e.target.value)} placeholder="MIT" /></div>
        </div>
        <div className="vault-two">
          <div className="vault-field"><label>Local path</label><input value={f.localPath} onChange={(e) => set("localPath", e.target.value)} placeholder="D:\dev\world-monitor" /></div>
          <div className="vault-field"><label>Remote URL</label><input value={f.remoteUrl} onChange={(e) => set("remoteUrl", e.target.value)} /></div>
        </div>
        <div className="vault-field">
          <label>Deploy key — an entry in this vault</label>
          <select value={f.deploySecretUuid} onChange={(e) => set("deploySecretUuid", e.target.value)}>
            <option value="">— none —</option>
            {secrets.filter((s) => !s.archived_at).map((s) => <option key={s.uuid} value={s.uuid}>{s.label}</option>)}
          </select>
        </div>
        <div className="vault-field"><label>README (markdown) — paste a snapshot</label><textarea value={f.readmeMd} onChange={(e) => set("readmeMd", e.target.value)} style={{ minHeight: 110 }} /></div>
        {err && <div className="vault-state error">{err}</div>}
        <div className="vault-modalacts">
          <button className="vault-btn" onClick={onClose}>Cancel</button>
          <button className="vault-btn primary" disabled={!f.name}
            onClick={() => void api.saveRepo({ ...f } as never).then(onSaved).catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))}>
            Save repo
          </button>
        </div>
      </div>
    </div>
  );
}

