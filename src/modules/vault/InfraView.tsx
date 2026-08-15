/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Infrastructure (MOCKUP-vault-full-v2): Servers & DNS · SSH keys · Import records.
//
// The two things that make this more than a table Cloudflare already has:
//   • every row knows which SSH key opens it and which runbook explains it — the cross-links ARE
//     the value; a DNS list on its own is a worse copy of the dashboard it came from.
//   • the SSH pane derives fingerprint and randomart from the PUBLIC key on every render and stores
//     neither (Jason 08-10-2026) — derived data cannot drift from the key it describes.
// The passphrase is the FIRST box on the SSH pane, because it is the thing the IDE keeps asking for
// and the reason that entry gets opened at all.
import { useCallback, useEffect, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import PackageLedger from "./PackageLedger";
import { vaultApi, type VaultDnsRecord, type VaultSecretMeta, type VaultServer, type VaultZoneRecord } from "./vaultApi";

type Tab = "servers" | "ssh" | "packages" | "import";

/**
 * `reloadKey` is bumped by the shared import modal (Jason 08-12-2026: "once imported, where is that
 * list served at? i dont see it… it loaded under servers & DNS in about 5mins on its own").
 *
 * The inline Import-records tab already reloaded itself; the HEADER Import button goes through the
 * module-level modal, whose onDone reloaded secrets and notes and knew nothing about servers or DNS.
 * So the rows were written and this view never asked again — until something unrelated happened to
 * remount it, which is the five minutes. Same one-counter fix the notes list needed.
 */
export default function InfraView({ secrets, onReload, onImport, onAddKey, reloadKey }: { secrets: VaultSecretMeta[]; onReload: () => void; onImport: () => void; onAddKey: () => void; reloadKey: number }) {
  const api = vaultApi();
  const [tab, setTab] = useState<Tab>("servers");
  const [servers, setServers] = useState<VaultServer[]>([]);
  const [dns, setDns] = useState<VaultDnsRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  // deleteServer/deleteDnsRecord existed in the service from day one with NO caller — the table
  // could import a hundred rows and remove none of them (Jason caught it on device, 08-11-2026).
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ title: string; body: React.ReactNode; label: string; run: () => void } | null>(null);

  const load = useCallback((): void => {
    void api.listServers().then(setServers).catch(() => setError("Servers could not be read."));
    void api.listDns().then(setDns).catch(() => setError("DNS records could not be read."));
  }, [api]);
  useEffect(() => { load(); }, [load, reloadKey]);

  /** A server row is a POINTER — removing it never touches the SSH key it names, and the dialog
      says so, because "delete server" reads like it might. */
  const removeServer = (s: VaultServer): void => {
    setAsk({
      title: `Remove ${s.host}?`,
      body: (
        <>
          <p>It comes out of the Infrastructure list.</p>
          <p className="vault-hint"><b>The SSH key it points at is untouched</b>, and so is the machine itself — this row was only ever a pointer.</p>
        </>
      ),
      label: "Remove",
      run: () => {
        setBusy(s.uuid);
        void api.deleteServer(s.uuid).then(load).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(null));
      },
    });
  };
  const removeDns = (d: VaultDnsRecord): void => {
    setAsk({
      title: `Remove the ${d.rtype} record for ${d.name}?`,
      body: (
        <>
          <p>It comes out of the vault's copy of this zone.</p>
          <p className="vault-hint"><b>Your real DNS is untouched.</b> This vault never edits a zone — it only keeps a record of one.</p>
        </>
      ),
      label: "Remove",
      run: () => {
        setBusy(d.uuid);
        void api.deleteDnsRecord(d.uuid).then(load).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(null));
      },
    });
  };

  /**
   * COPY THE VALUE OUT OF THE ROW (Jason 08-12-2026: "incase i want to copy the content to paste it
   * somewhere else, ill have it ready to go, and not fumble the ball trying to select a line and
   * hitting control + C").
   *
   * The Content column is `.vault-clip` — a long TXT value (a DKIM key, an SPF include list) is cut
   * off with an ellipsis, so the part you most need to paste is the part you cannot even select.
   * The button copies the WHOLE stored value, not the truncated text on screen.
   *
   * No logging and no read gate, unlike the password copies: a DNS record is public by definition —
   * it is what a resolver hands to anyone who asks — so there is no secret leaving the vault here.
   */
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (id: string, value: string): void => {
    void api.copyText(value)
      .then(() => { setCopied(id); setTimeout(() => setCopied((c) => (c === id ? null : c)), 1400); })
      .catch(() => setError("The clipboard could not be written to."));
  };

  const sshKeys = secrets.filter((s) => s.kind === "ssh_key" && !s.archived_at);
  const counts = {
    total: dns.length,
    a: dns.filter((d) => d.rtype === "A").length,
    mx: dns.filter((d) => d.rtype === "MX").length,
    txt: dns.filter((d) => d.rtype === "TXT").length,
    proxied: dns.filter((d) => d.proxied === 1).length,
  };

  return (
    <>
      <div className="vault-modeswitch">
        <div className="vault-seg">
          {/* Package ledger sits BETWEEN SSH keys and Import records (Jason 08-11-2026) — it moved
              here from Repos, because it inventories what this machine stands on, which is what
              every other tab on this surface does. */}
          {([["servers", "Servers & DNS"], ["ssh", "SSH keys"], ["packages", "Package ledger"], ["import", "Import records"]] as [Tab, string][]).map(([t, l]) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{l}</button>
          ))}
        </div>
        {/* Infrastructure's own document importer — separate from "Import records", which is the
            exact zone-file parser. Different job: one reads DNS, this one reads notes about it.
            Hidden on the ledger, which reads the installed tree and imports nothing. */}
        {tab !== "packages" && (
          <button className="vault-btn" style={{ marginLeft: "auto" }} onClick={onImport}>⭳ Import</button>
        )}
      </div>
      {error && <div className="vault-state error">{error}</div>}

      {tab === "servers" && (
        <>
          <div className="vault-chips">
            <Chip k="Records" v={counts.total} />
            <Chip k="A" v={counts.a} />
            <Chip k="MX" v={counts.mx} />
            <Chip k="TXT" v={counts.txt} />
            <Chip k="Proxied" v={counts.proxied} colour="var(--mc-accent-primary)" />
            <Chip k="Servers" v={servers.length} />
          </div>
          <div className="vault-card">
            <div className="vault-cardhead"><span className="vault-cardtitle">Servers</span></div>
            {servers.length === 0 ? (
              <div className="vault-state">No servers recorded yet.</div>
            ) : (
              <div className="vault-tscroll">
                <table className="vault-table">
                  <thead><tr><th>Host</th><th>Address</th><th>Provider</th><th>Role</th><th>Opens with</th><th style={{ width: 82 }} /></tr></thead>
                  <tbody>
                    {servers.map((s) => {
                      const key = secrets.find((k) => k.uuid === s.ssh_secret_uuid);
                      return (
                        <tr key={s.uuid}>
                          <td><b>{s.host}</b></td>
                          <td className="vault-mono">{s.address ?? "—"}</td>
                          <td>{s.provider ?? "—"}</td>
                          <td>{s.role ? <span className="vault-kind">{s.role}</span> : "—"}</td>
                          <td>{key ? <span className="vault-chip"><span className="lk">🔑 {key.label}</span></span> : <span className="vault-who">not linked</span>}</td>
                          {/* Same pair as the DNS rows — an address is the thing you paste into an
                              ssh command, and it is no more secret than the row it sits in. */}
                          <td className="vault-rowacts">
                            <button
                              className="vault-btn sm"
                              disabled={!s.address}
                              title={s.address ? `Copy the address — ${s.address}` : "No address recorded"}
                              onClick={() => s.address && copy(s.uuid, s.address)}
                            >
                              {copied === s.uuid ? "✓" : "⧉"}
                            </button>
                            <button className="vault-btn sm danger" disabled={busy === s.uuid} title="Remove this server" onClick={() => removeServer(s)}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="vault-card">
            <div className="vault-cardhead">
              <span className="vault-cardtitle">DNS records</span>
              <button className="vault-btn" onClick={() => setTab("import")}>+ Import records</button>
            </div>
            {dns.length === 0 ? (
              <div className="vault-state">Nothing imported yet. <div><button className="vault-btn primary" onClick={() => setTab("import")}>Import a zone file</button></div></div>
            ) : (
              <div className="vault-tscroll">
                <table className="vault-table">
                  <thead><tr><th>Name</th><th style={{ width: 56 }}>Type</th><th>Content</th><th style={{ width: 120 }}>Proxy</th><th>Comment</th><th style={{ width: 82 }} /></tr></thead>
                  <tbody>
                    {dns.map((d) => (
                      <tr key={d.uuid}>
                        <td><b>{d.name}</b></td>
                        <td className="vault-mono">{d.rtype}</td>
                        <td className="vault-mono vault-clip">{d.content}</td>
                        <td>{d.proxied === 1 ? <span className="vault-kind warn">☁ Proxied</span> : <span className="vault-kind">DNS only</span>}</td>
                        <td className="vault-who">{d.comment ?? "—"}</td>
                        <td className="vault-rowacts">
                          {/* Left of the ✕ on purpose: the harmless action should never be the one
                              your hand lands on by muscle memory next to a delete. */}
                          <button
                            className="vault-btn sm"
                            title={`Copy this record's content — ${d.content}`}
                            onClick={() => copy(d.uuid, d.content)}
                          >
                            {copied === d.uuid ? "✓" : "⧉"}
                          </button>
                          <button className="vault-btn sm danger" disabled={busy === d.uuid} title="Remove this record" onClick={() => removeDns(d)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "ssh" && <SshPane keys={sshKeys} onReload={onReload} onAddKey={onAddKey} />}
      {tab === "packages" && <PackageLedger />}
      {tab === "import" && <ImportRecords onImported={() => { load(); setTab("servers"); }} />}

      {ask && (
        <ConfirmModal title={ask.title} body={ask.body} confirmLabel={ask.label} danger
          onConfirm={ask.run} onClose={() => setAsk(null)} />
      )}
    </>
  );
}

function Chip({ k, v, colour }: { k: string; v: number; colour?: string }) {
  return <div className="vault-chip-stat"><span className="k">{k}</span><span className="v" style={colour ? { color: colour } : undefined}>{v}</span></div>;
}

// ---------------------------------------------------------------- SSH
function SshPane({ keys, onReload, onAddKey }: { keys: VaultSecretMeta[]; onReload: () => void; onAddKey: () => void }) {
  const api = vaultApi();
  const [sel, setSel] = useState<string | null>(keys[0]?.uuid ?? null);
  const [art, setArt] = useState<{ ok: boolean; error?: string; fingerprint?: string; randomart?: string } | null>(null);
  const [pass, setPass] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!sel && keys[0]) setSel(keys[0].uuid); }, [keys, sel]);
  useEffect(() => {
    setPass(null); setCopied(false); setArt(null);
    if (sel) void api.sshArt(sel).then(setArt).catch(() => setArt({ ok: false, error: "The art could not be derived." }));
  }, [api, sel]);

  const current = keys.find((k) => k.uuid === sel) ?? null;
  const reveal = (): void => {
    if (!current) return;
    if (pass !== null) return setPass(null);
    setBusy(true);
    void api.read(current.uuid).then((f) => setPass(f.extras?.passphrase ?? "(no passphrase stored)")).catch(() => undefined).finally(() => setBusy(false));
  };
  const copyPass = (): void => {
    if (!current) return;
    setBusy(true);
    void api.read(current.uuid).then((f) => api.copyText(f.extras?.passphrase ?? "")).then(() => setCopied(true)).catch(() => undefined).finally(() => setBusy(false));
  };

  if (keys.length === 0) {
    // THE OLD COPY NAMED TWO THINGS THAT WERE NOT ON THIS SCREEN: "+ New entry" is a Passwords-tab
    // button, and the "SSH key" kind was not in the picker at all. An empty state that tells you to
    // use a control you cannot reach is worse than one that says nothing (Jason 08-12-2026).
    return (
      <div className="vault-state">
        No SSH keys yet. Paste a public key and the fingerprint and randomart appear here automatically —
        derived on every render, never stored.
        <div style={{ marginTop: 14 }}>
          <button className="vault-btn primary" onClick={onAddKey}>+ Add SSH key</button>
        </div>
      </div>
    );
  }
  return (
    <div className="vault-two">
      <div className="vault-card">
        {/* The button lives in the card head, not only in the empty state — you need it most on the
            SECOND key, by which time the empty state is long gone. */}
        <div className="vault-cardhead">
          <span className="vault-cardtitle">SSH keys</span>
          <button className="vault-btn sm primary" onClick={onAddKey}>+ Add SSH key</button>
        </div>
        {keys.map((k) => (
          <button key={k.uuid} className={`vault-railrow${sel === k.uuid ? " on" : ""}`} onClick={() => setSel(k.uuid)}>
            <span className="vault-raildot" style={{ background: "var(--vault-strong-color)" }} />
            <span className="vault-railname">{k.label}</span>
          </button>
        ))}
        {current && (
          <>
            {/* THE PASSPHRASE IS THE TOP BOX (Jason 08-10-2026) — it is what the IDE keeps asking for. */}
            <div className="vault-fbox nb" style={{ marginTop: 14 }}>
              <div className="vault-flabel">Passphrase <span className="vault-kind danger">secret</span>
                <span className="vault-who" style={{ marginLeft: "auto", textTransform: "none" }}>what the IDE keeps asking for</span></div>
              <div className="vault-fvalue">
                <span className={pass ? "vault-revealed" : "vault-masked"}>{pass ?? "••••••••••••••"}</span>
                <span className="vault-facts">
                  <button className="vault-btn" disabled={busy} onClick={reveal}>{pass !== null ? "Hide" : "Reveal"}</button>
                  <button className="vault-btn primary" disabled={busy} onClick={copyPass}>{copied ? "Copied" : "Copy"}</button>
                </span>
              </div>
            </div>
            <div className="vault-fbox">
              <div className="vault-flabel">Public key <span className="vault-kind">not secret</span></div>
              <div className="vault-keybox">{current.public_key || "Not stored — add it on the entry to see the fingerprint and art."}</div>
            </div>
          </>
        )}
      </div>
      <div className="vault-card">
        <div className="vault-cardhead"><span className="vault-cardtitle">Derived — never stored</span></div>
        {!art ? (
          <div className="vault-state">Deriving…</div>
        ) : !art.ok ? (
          <div className="vault-state">{art.error}</div>
        ) : (
          <>
            <div className="vault-flabel">Fingerprint <span className="vault-derived">derived</span></div>
            <div className="vault-fvalue vault-mono" style={{ fontSize: 11.5, marginBottom: 14 }}>{art.fingerprint}</div>
            <div className="vault-flabel">Randomart <span className="vault-derived">derived</span></div>
            <pre className="vault-art">{art.randomart}</pre>
            <div className="vault-hint" style={{ marginTop: 12 }}>
              This is the picture your terminal draws on first connect. Put the two side by side and you can tell at a
              glance whether you are talking to the right machine — which is the entire reason the picture exists.
            </div>
            <div className="vault-btnrow" style={{ marginTop: 12 }}>
              <button className="vault-btn" onClick={() => { void api.copyText(current?.public_key ?? ""); onReload(); }}>Copy public key</button>
              <button className="vault-btn" onClick={() => void api.copyText(art.fingerprint ?? "")}>Copy fingerprint</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- import records
function ImportRecords({ onImported }: { onImported: () => void }) {
  const api = vaultApi();
  const [path, setPath] = useState<"zone" | "shot" | "manual">("zone");
  const [text, setText] = useState("");
  const [domain, setDomain] = useState("");
  const [parsed, setParsed] = useState<{ records: VaultZoneRecord[]; flagged: { record: VaultZoneRecord; why: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const parse = (): void => {
    setBusy(true); setMsg(null);
    void api.parseZone(text)
      .then((r) => {
        setParsed(r);
        // The zone's own records name the domain — no need to ask for what the file already says.
        if (!domain && r.records[0]) {
          const parts = r.records[0].name.split(".");
          if (parts.length >= 2) setDomain(parts.slice(-2).join("."));
        }
      })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const commit = (): void => {
    if (!parsed || !domain) return;
    setBusy(true);
    void api.importZone(domain, parsed.records)
      .then((r) => {
        // An empty approval is a no-op server-side (Tier-1 fix 3) — show its sentence and keep the
        // review table on screen; only a real import clears the workspace.
        setMsg(r.message ?? `${r.imported} records imported for ${domain}.`);
        if (r.imported > 0) { setParsed(null); setText(""); onImported(); }
      })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className="vault-paths">
        <button className={`vault-path${path === "zone" ? " on" : ""}`} onClick={() => setPath("zone")}>
          <span className="pi">📄</span><span className="pt">Paste a zone file / CSV</span>
          <span className="pd">Exact — a defined format, parsed on this machine, no model and no guessing. <b>Use this whenever an export exists.</b></span>
        </button>
        <button className={`vault-path${path === "shot" ? " on" : ""}`} onClick={() => setPath("shot")}>
          <span className="pi">🖼</span><span className="pt">Paste a screenshot</span>
          <span className="pd">For when there is no export button. A local model reads the image; every field arrives with a confidence and nothing saves until you approve it.</span>
        </button>
        <button className={`vault-path${path === "manual" ? " on" : ""}`} onClick={() => setPath("manual")}>
          <span className="pi">✎</span><span className="pt">Type one in</span>
          <span className="pd">One record by hand — always available, and the fallback when the other two disagree with what you know.</span>
        </button>
      </div>

      {path === "zone" && (
        <div className="vault-card">
          <div className="vault-cardhead"><span className="vault-cardtitle">Paste the export</span>
            <span className="vault-hint">BIND zone format · nothing is written until you press Import</span></div>
          <textarea className="vault-zone" value={text} placeholder=";; A Records&#10;admin.example.com.	1	IN	A	203.0.113.10 ; cf_tags=cf-proxied:true"
            onChange={(e) => { setText(e.target.value); setParsed(null); }} />
          <div className="vault-btnrow" style={{ marginTop: 10, alignItems: "center" }}>
            <button className="vault-btn primary" disabled={!text.trim() || busy} onClick={parse}>{busy ? "Reading…" : "Read the file"}</button>
            {parsed && (
              <>
                <span className="vault-kind">{parsed.records.length} records parsed</span>
                {parsed.flagged.length > 0 && <span className="vault-kind warn">{parsed.flagged.length} flagged for your eye</span>}
                <input className="vault-domainin" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="domain, e.g. example.com" />
                <button className="vault-btn primary" disabled={!domain || busy} onClick={commit} style={{ marginLeft: "auto" }}>Import {parsed.records.length}</button>
              </>
            )}
          </div>
          {parsed && parsed.flagged.length > 0 && (
            <ul className="vault-reasons" style={{ marginTop: 10 }}>
              {parsed.flagged.map((f, i) => <li key={i}><b>{f.record.name}</b> — {f.why}</li>)}
            </ul>
          )}
          {parsed && parsed.records.length > 0 && (
            <div className="vault-tscroll" style={{ marginTop: 12 }}>
              <table className="vault-table">
                <thead><tr><th>Name</th><th>Type</th><th>Content</th><th>Proxy</th></tr></thead>
                <tbody>
                  {parsed.records.slice(0, 20).map((r, i) => (
                    <tr key={i}><td className="vault-mono">{r.name}</td><td className="vault-mono">{r.rtype}</td>
                      <td className="vault-mono vault-clip">{r.content}</td>
                      <td>{r.proxied === 1 ? <span className="vault-kind warn">☁</span> : <span className="vault-who">—</span>}</td></tr>
                  ))}
                </tbody>
              </table>
              {parsed.records.length > 20 && <div className="vault-hint" style={{ padding: "8px 2px" }}>…and {parsed.records.length - 20} more.</div>}
            </div>
          )}
          {msg && <div className="vault-hint" style={{ marginTop: 10 }}>{msg}</div>}
        </div>
      )}

      {path === "shot" && (
        <div className="vault-card">
          <div className="vault-cardhead"><span className="vault-cardtitle">Read a screenshot</span></div>
          <div className="vault-drop">Drop an image here, or paste with <b>Ctrl+V</b></div>
          <div className="vault-hint" style={{ marginTop: 12 }}>
            <b>Not built yet — and it needs a decision first.</b> The image would go to a vision model running on
            this computer and nowhere else: the vault has exactly two features that touch the internet and both live
            on the Health tab behind a switch. Which local model to require is still open, so the zone-file path is
            the one that ships. <b>Use the export whenever one exists — it is exact, and this never will be.</b>
          </div>
        </div>
      )}

      {path === "manual" && <ManualRecord onSaved={onImported} />}
    </>
  );
}

function ManualRecord({ onSaved }: { onSaved: () => void }) {
  const api = vaultApi();
  const [f, setF] = useState({ domain: "", name: "", rtype: "A", content: "", comment: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string): void => setF((p) => ({ ...p, [k]: v }));
  const save = (): void => {
    void api.saveDnsRecord({ ...f })
      .then(() => { setMsg("Added."); setF({ domain: f.domain, name: "", rtype: "A", content: "", comment: "" }); onSaved(); })
      .catch((e: unknown) => setMsg(e instanceof Error ? e.message : String(e)));
  };
  return (
    <div className="vault-card">
      <div className="vault-cardhead"><span className="vault-cardtitle">One record</span></div>
      <div className="vault-two">
        <div className="vault-field"><label>Domain</label><input value={f.domain} onChange={(e) => set("domain", e.target.value)} placeholder="example.com" /></div>
        <div className="vault-field"><label>Name</label><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="status" /></div>
      </div>
      <div className="vault-two">
        <div className="vault-field"><label>Type</label>
          <select value={f.rtype} onChange={(e) => set("rtype", e.target.value)}>
            {["A", "AAAA", "CNAME", "MX", "TXT", "CAA", "SRV"].map((t) => <option key={t}>{t}</option>)}
          </select></div>
        <div className="vault-field"><label>Content</label><input value={f.content} onChange={(e) => set("content", e.target.value)} placeholder="203.0.113.10" /></div>
      </div>
      <div className="vault-field"><label>Comment</label><input value={f.comment} onChange={(e) => set("comment", e.target.value)} /></div>
      <div className="vault-modalacts">
        <button className="vault-btn primary" disabled={!f.domain || !f.name || !f.content} onClick={save}>Add record</button>
      </div>
      {msg && <div className="vault-hint" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
