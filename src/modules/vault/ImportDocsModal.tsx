/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The importer — DESTINATION FIRST (Jason 08-11-2026), which is the fix for a real bug.
//
// THE BUG. This modal used to be a document importer wearing whatever title the tab gave it. The
// `target` chose the file-dialog FILTER and nothing else; the write always went to
// notes.importDocs. So a DNS zone export chosen from Infrastructure became a Secured Note, the
// modal asked "All as Notes / Runbooks / Snippets" on the Infrastructure tab, and the zone parser
// that would have handled it correctly — infra.parseZone, already built and proven — sat unused.
// Jason hit it on device: "i imported a avertxai.com.txt file but where did it land? it didnt."
//
// THE SHAPE NOW. Choose a destination → choose a file or folder → REVIEW what was understood →
// commit. The destination decides the parser AND the table you review, so what you are about to
// create is on screen before anything is written. Three routes:
//   · dns      → infra.parseZone   → infra.importZone     (real DNS rows)
//   · servers  → infra.parseServers→ infra.importServers  (real host rows)
//   · docs/note/runbook/snippet → notes.importDocs        (the original path, unchanged)
//
// NOTHING IS WRITTEN UNTIL THE COMMIT BUTTON. Every parse is pure and main-side; the review table
// is built from its return value. A half-imported inventory is not a result — both structured
// importers commit in one transaction.
import { useCallback, useEffect, useMemo, useState } from "react";
import Loading from "./Loading";
import { vaultApi, type VaultParsedServer, type VaultWalkResult, type VaultWalkedFile, type VaultZoneRecord } from "./vaultApi";

// "repos" was DELETED from this union with the mount (08-14-2026): the Repos tab's generic import
// was removed 08-12-2026 (see ReposView.tsx) and the destination had been unreachable since.
export type ImportTarget = "notes" | "infra";

/** Every place a file can land. `docs` is the original note-shaped import. */
type Dest = "auto" | "note" | "runbook" | "snippet" | "dns" | "servers" | "sshkeys" | "docs";

interface DestDef {
  id: Dest;
  title: string;
  blurb: string;
  exts: string;
  /** Structured destinations parse and review; the rest walk files. */
  structured?: "dns" | "servers";
  /** Present but refusing, with the reason on screen. See the SSH note below. */
  disabled?: string;
}

/**
 * THE SSH KEY DESTINATION IS DELIBERATELY REFUSING, and it says why rather than being absent.
 * An SSH entry in this vault is a KEY PAIR — the private key is the credential (`value`, which the
 * store requires to be non-empty) and the public key rides beside it for the fingerprint and
 * randomart. A `.pub` file or an `authorized_keys` line carries only the public half, so importing
 * one would either invent a private key or store a credential-shaped row with no credential in it.
 * Both are worse than refusing. Whether the vault should hold public-key-only inventory entries is
 * Jason's ruling, not mine to assume — so the card states the position and points at the path that
 * does work today.
 */
const DESTS: Record<ImportTarget, DestDef[]> = {
  infra: [
    { id: "dns", title: "DNS records", blurb: "A zone export or a records CSV. Parsed into real rows you can filter and edit.", exts: ".zone · .txt · .csv", structured: "dns" },
    { id: "servers", title: "Servers", blurb: "A host inventory — name, address, provider, role. One row per machine.", exts: ".csv · .json", structured: "servers" },
    { id: "sshkeys", title: "SSH keys", blurb: "An SSH entry is a key PAIR, and a .pub file is only the public half.", exts: "needs the private key", disabled: "A .pub file carries only the public half of a key pair, and the vault stores the private key as the credential with the public one beside it. Add the key with + New entry and pick the SSH key kind — the fingerprint and randomart then appear automatically." },
    { id: "docs", title: "Notes about it", blurb: "A PDF or a write-up that is documentation, not data. Lands in Secured Notes.", exts: ".md · .txt · .pdf" },
  ],
  notes: [
    { id: "auto", title: "Work it out", blurb: "Read each file and decide from its shape and frontmatter.", exts: ".md · .txt · .pdf" },
    { id: "note", title: "Notes", blurb: "Everything lands as a plain note.", exts: ".md · .txt · .pdf" },
    { id: "runbook", title: "Runbooks", blurb: "Numbered steps get copy buttons and ticks in Run mode.", exts: ".md · .txt" },
    { id: "snippet", title: "Ideas", blurb: "Things you are thinking about — sketches, concepts, fragments.", exts: ".md · .txt" },
  ],
};

const TITLES: Record<ImportTarget, string> = {
  notes: "Import into Secured Notes",
  infra: "Import into Infrastructure",
};

type Result =
  | {
      kind: "docs"; scanned: number; created: number; warned: number; skipped: number;
      skippedFiled: number; skippedUnfiled: number; skippedArchived: number;
      failed: number; problems: { file: string; reason: string }[];
    }
  | { kind: "dns" | "servers"; created: number };

export default function ImportDocsModal({ target, onClose, onDone }: { target: ImportTarget; onClose: () => void; onDone: () => void }) {
  const api = vaultApi();
  const dests = DESTS[target];
  const [dest, setDest] = useState<Dest>(dests[0]?.id ?? "docs");
  const [roots, setRoots] = useState<string[]>([]);
  const [walk, setWalk] = useState<VaultWalkResult | null>(null);
  const [folder, setFolder] = useState("");
  /** MIRROR THE FOLDERS ON DISK (Jason 08-11-2026). Default ON: you already arranged that tree, and
      collapsing 2,000 files into one "Category" is what made the first import disappointing. */
  const [mirror, setMirror] = useState(true);
  const [folderPreview, setFolderPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Structured routes: the file that was read, and what the parser understood.
  const [sourceName, setSourceName] = useState("");
  const [zone, setZone] = useState<{ records: VaultZoneRecord[]; flagged: { record: VaultZoneRecord; why: string }[] } | null>(null);
  const [domain, setDomain] = useState("");
  const [servers, setServers] = useState<{ servers: VaultParsedServer[]; skipped: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const def = useMemo(() => dests.find((d) => d.id === dest) ?? dests[0], [dests, dest]);
  const structured = def?.structured;

  /** Switching destination throws away the previous parse — reviewing a zone file as a host
      inventory would be nonsense, and keeping a stale table on screen is how that happens. */
  const pickDest = (d: Dest): void => {
    setDest(d);
    setWalk(null); setRoots([]); setZone(null); setServers(null); setSourceName(""); setDomain(""); setError(null);
  };

  const chooseFiles = useCallback((): void => {
    setError(null);
    void api.chooseFiles(target)
      .then((picked) => {
        if (picked.length === 0) return; // cancelled — nothing should change on screen
        setBusy(true);
        // STRUCTURED: read one file's text and parse it. Multi-select is a document idea; a zone
        // file and a host inventory are each one document with one shape.
        if (structured) {
          const path = picked[0] as string;
          setSourceName(path.split(/[\\/]/).pop() ?? path);
          return api.readImportText(path)
            .then((text) =>
              structured === "dns"
                ? api.parseZone(text).then((r) => {
                    setZone(r);
                    // The records name the domain — no need to ask for what the file already says.
                    const first = r.records[0];
                    if (first) {
                      const parts = first.name.split(".");
                      if (parts.length >= 2) setDomain(parts.slice(-2).join("."));
                    }
                  })
                : api.parseServers(text).then(setServers)
            )
            .finally(() => setBusy(false));
        }
        setFolderPreview(null);
        return api.statFiles(picked).then((r) => {
          // Files ACCUMULATE across picks, so choosing twice adds rather than replaces.
          setWalk((prev) => {
            if (!prev) return r;
            const seen = new Set(prev.files.map((f) => f.path));
            return { ...r, files: [...prev.files, ...r.files.filter((f) => !seen.has(f.path))], skipped: prev.skipped };
          });
        }).finally(() => setBusy(false));
      })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)); setBusy(false); });
  }, [api, target, structured]);

  const chooseFolders = useCallback((): void => {
    setError(null);
    void api.chooseFolders()
      .then((picked) => {
        if (picked.length === 0) return;
        const next = [...new Set([...roots, ...picked])];
        setRoots(next);
        setBusy(true);
        return api.walkFolders(next)
          .then((r) => {
            setWalk(r);
            // The preview is pure and main-side — it writes nothing and tells you the folder count
            // BEFORE you commit, which is the whole point of showing it here.
            void api.previewFolderPaths(r.files.map((f) => f.rel)).then(setFolderPreview).catch(() => setFolderPreview([]));
          })
          .finally(() => setBusy(false));
      })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)); setBusy(false); });
  }, [api, roots]);

  const dropRoot = (r: string): void => {
    const next = roots.filter((x) => x !== r);
    setRoots(next);
    if (next.length === 0) return setWalk(null);
    setBusy(true);
    void api.walkFolders(next).then(setWalk).finally(() => setBusy(false));
  };

  const dropFile = (p: string): void =>
    setWalk((prev) => (prev ? { ...prev, files: prev.files.filter((f) => f.path !== p) } : prev));

  /** MM-DD-YYYY, month-first everywhere a human sees it (canon). */
  const shortDate = (ms: number): string => {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "—";
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
  };

  const run = (): void => {
    setBusy(true);
    setError(null);
    const done = (r: Result): void => { setResult(r); onDone(); };
    const fail = (e: unknown): void => setError(e instanceof Error ? e.message : String(e));

    if (structured === "dns") {
      if (!zone || !domain.trim()) { setBusy(false); return; }
      void api.importZone(domain.trim(), zone.records)
        .then((r) => (r.imported === 0
          ? setError(r.message ?? "Nothing was approved, so nothing was changed.")
          : done({ kind: "dns", created: r.imported })))
        .catch(fail).finally(() => setBusy(false));
      return;
    }
    if (structured === "servers") {
      if (!servers || servers.servers.length === 0) { setBusy(false); return; }
      void api.importServers(servers.servers)
        .then((r) => done({ kind: "servers", created: r.imported })).catch(fail).finally(() => setBusy(false));
      return;
    }
    if (!walk || walk.files.length === 0) { setBusy(false); return; }
    // `auto` and the three note kinds map straight onto importDocs' existing `kind` argument.
    const kind = dest === "docs" ? "auto" : dest;
    void api.importDocs(walk.files, { kind, folder: folder || null, mirror })
      .then((r) => done({
        kind: "docs", scanned: r.scanned ?? walk.files.length, created: r.created,
        warned: r.warned, skipped: r.skipped ?? 0,
        skippedFiled: r.skippedFiled ?? 0, skippedUnfiled: r.skippedUnfiled ?? 0, skippedArchived: r.skippedArchived ?? 0,
        failed: r.failed ?? 0, problems: r.problems,
      }))
      .catch(fail).finally(() => setBusy(false));
  };

  const kb = (n: number): string => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);

  const count = structured === "dns" ? (zone?.records.length ?? 0)
    : structured === "servers" ? (servers?.servers.length ?? 0)
    : (walk?.files.length ?? 0);
  const noun = structured === "dns" ? "records" : structured === "servers" ? "servers" : "files";
  const canGo = count > 0 && !busy && !def?.disabled && (structured !== "dns" || domain.trim() !== "");

  return (
    <div className="vault-modalback" onClick={onClose}>
      <div className="vault-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        {/* ONCE IT IS DONE, THE TITLE SAYS SO. Leaving the instruction above a finished result reads
            as an instruction for something already finished, and the "nothing is written yet"
            reassurance is actively untrue by then. */}
        <h3>{result ? `Imported ${result.created} ${result.created === 1 ? noun.replace(/s$/, "") : noun}` : TITLES[target]}</h3>
        <div className="vault-modalsub">
          {result ? "Done — nothing else will be written." : "Nothing is written until you press Import."}
        </div>

        {result ? (
          <>
            <div className="vault-card" style={{ margin: "6px 0 0", background: "var(--mc-nested)" }}>
              <div className="vault-cardtitle" style={{ color: "var(--vault-strong-color)", marginBottom: 8 }}>
                {result.created} imported
              </div>
              {/* THE ARITHMETIC, STATED (Jason 08-12-2026: "the import message is wrong. i can clearly
                  see the _source folder has 2078 files total, but the imported completed modal states
                  there was '2083 were already in the vault'").
                  The old line gave one number with nothing to check it against, and it was being read
                  against the folder's count in the tree — which counts something else entirely. These
                  three always sum to the files read, so the number can be verified at a glance rather
                  than taken on trust. */}
              {result.kind === "docs" && (
                <div className="vault-hint" style={{ marginBottom: 8 }}>
                  <b>{result.scanned.toLocaleString()} files read</b> — {result.created.toLocaleString()} new,{" "}
                  {result.skipped.toLocaleString()} already here
                  {result.failed > 0 && <>, {result.failed.toLocaleString()} could not be stored</>}.
                </div>
              )}
              {/* THE BREAKDOWN, because "it counts a wider set" was an explanation and not a number.
                  These three sum to the skipped total, and the FILED line is the one that lines up
                  with the folder count in the sidebar — so the gap between them is now a figure you
                  can point at rather than a discrepancy you have to take on faith. */}
              {result.kind === "docs" && result.skipped > 0 && (
                <div className="vault-hint" style={{ marginBottom: 8 }}>
                  The <b>{result.skipped.toLocaleString()} already here</b> were left alone — importing the same folder
                  twice adds what is new instead of a second copy of everything. Where those notes are now:
                  <ul className="vault-reasons" style={{ marginTop: 6 }}>
                    <li><b>{result.skippedFiled.toLocaleString()}</b> filed in folders — this is the number the sidebar counts.</li>
                    {result.skippedUnfiled > 0 && (
                      <li><b>{result.skippedUnfiled.toLocaleString()}</b> unfiled — in the vault, in no folder.</li>
                    )}
                    {result.skippedArchived > 0 && (
                      <li>
                        <b>{result.skippedArchived.toLocaleString()}</b> archived — on the <b>Archived</b> shelf, which no
                        folder count includes. This is the difference between the two numbers.
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {result.kind === "docs" && result.warned > 0 ? (
                <>
                  <div className="vault-hint">
                    {result.warned} had a frontmatter block that could not be read. <b>They were imported anyway</b>, with the
                    text kept and a warning line at the top — a file that will not parse is never thrown away.
                  </div>
                  <ul className="vault-reasons" style={{ marginTop: 8 }}>
                    {result.problems.slice(0, 10).map((p) => (<li key={p.file}><b>{p.file}</b> — {p.reason}</li>))}
                    {result.problems.length > 10 && <li>…and {result.problems.length - 10} more.</li>}
                  </ul>
                </>
              ) : (
                <div className="vault-hint">
                  {result.kind === "dns" ? <>They are on <b>Servers &amp; DNS</b> now, under {domain}.</>
                    : result.kind === "servers" ? <>They are on <b>Servers &amp; DNS</b> now.</>
                    : "Every file came across cleanly."}
                </div>
              )}
            </div>
            <div className="vault-modalacts"><button className="vault-btn primary" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            {/* WHERE IT GOES, chosen before anything is read. */}
            <div className="vault-dests">
              {dests.map((d) => (
                <button key={d.id} className={`vault-dcard${dest === d.id ? " on" : ""}${d.disabled ? " off" : ""}`} onClick={() => pickDest(d.id)}>
                  <b>{d.title}</b>
                  <span>{d.blurb}</span>
                  <span className="ex">{d.exts}</span>
                </button>
              ))}
            </div>

            {def?.disabled ? (
              <div className="vault-state" style={{ textAlign: "left" }}>{def.disabled}</div>
            ) : (
              <>
                <button className="vault-drop" onClick={chooseFiles} disabled={busy}>
                  <b>{structured ? "Choose a file" : "Choose files"}</b>
                  <span className="vault-hint" style={{ display: "block", marginTop: 5 }}>
                    {structured === "dns" ? "The zone export or records CSV you downloaded."
                      : structured === "servers" ? "A host inventory as CSV or JSON."
                      : "One or several — they add up if you choose twice."}
                  </span>
                </button>
                {/* FILE OR FOLDER, ON EVERY TAB (Jason 08-11-2026). Structured parsers read one
                    document, so the folder option is offered only where a walk makes sense. */}
                {!structured && (
                  <div className="vault-btnrow" style={{ marginTop: 9, justifyContent: "center" }}>
                    <button className="vault-btn" onClick={chooseFolders} disabled={busy}>…or choose a whole folder</button>
                  </div>
                )}
              </>
            )}

            {roots.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="vault-cardtitle" style={{ marginBottom: 8 }}>{roots.length} folder{roots.length === 1 ? "" : "s"} chosen</div>
                {roots.map((r) => (
                  <div key={r} className="vault-folderline">
                    <span>📁</span>
                    <span className="vault-mono vault-clip" style={{ flex: 1 }}>{r}</span>
                    <button className="vault-btn sm danger" onClick={() => dropRoot(r)}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {busy && !result && (
              <Loading compact message={count > 0 ? `Importing ${count} ${noun}…` : "Reading…"} />
            )}

            {/* ---- REVIEW: DNS ---- */}
            {structured === "dns" && zone && !busy && (
              <div style={{ marginTop: 13 }}>
                <div className="vault-btnrow" style={{ marginBottom: 8, alignItems: "center" }}>
                  <span className="vault-kind ok">{zone.records.length} records read</span>
                  {zone.flagged.length > 0 && <span className="vault-kind warn">{zone.flagged.length} flagged</span>}
                  <span className="vault-who">{sourceName}</span>
                </div>
                <div className="vault-field" style={{ maxWidth: 280 }}>
                  <label htmlFor="imp-domain">Domain these belong to</label>
                  <input id="imp-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
                </div>
                <div className="vault-tscroll" style={{ maxHeight: 190 }}>
                  <table className="vault-table">
                    <thead><tr><th>Name</th><th style={{ width: 78 }}>Type</th><th>Content</th><th style={{ width: 62 }}>TTL</th></tr></thead>
                    <tbody>
                      {zone.records.slice(0, 40).map((r, i) => (
                        <tr key={`${r.name}-${r.rtype}-${i}`}>
                          <td className="vault-mono">{r.name}</td>
                          <td><span className="vault-kind">{r.rtype}</span></td>
                          <td className="vault-mono vault-clip">{r.content}</td>
                          <td className="vault-mono">{r.ttl ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {zone.records.length > 40 && <div className="vault-hint" style={{ marginTop: 6 }}>…and {zone.records.length - 40} more.</div>}
                {zone.flagged.length > 0 && (
                  <div className="vault-hint" style={{ marginTop: 8 }}>
                    <b style={{ color: "var(--vault-warn-color)" }}>Flagged, never changed.</b>{" "}
                    {zone.flagged.slice(0, 3).map((f) => f.why).join(" · ")} — the vault reports your DNS, it does not edit it.
                  </div>
                )}
              </div>
            )}

            {/* ---- REVIEW: servers ---- */}
            {structured === "servers" && servers && !busy && (
              <div style={{ marginTop: 13 }}>
                <div className="vault-btnrow" style={{ marginBottom: 8, alignItems: "center" }}>
                  <span className="vault-kind ok">{servers.servers.length} servers read</span>
                  {servers.skipped > 0 && <span className="vault-kind">{servers.skipped} skipped · no host name</span>}
                  <span className="vault-who">{sourceName}</span>
                </div>
                {servers.servers.length === 0 ? (
                  <div className="vault-state" style={{ textAlign: "left" }}>
                    No host column was recognised in that file. A header row naming <code>host</code> (or hostname, name,
                    server, fqdn) is what this reads — nothing was imported.
                  </div>
                ) : (
                  <div className="vault-tscroll" style={{ maxHeight: 190 }}>
                    <table className="vault-table">
                      <thead><tr><th>Host</th><th>Address</th><th>Provider</th><th>Role</th></tr></thead>
                      <tbody>
                        {servers.servers.slice(0, 40).map((s, i) => (
                          <tr key={`${s.host}-${i}`}>
                            <td><b>{s.host}</b></td>
                            <td className="vault-mono">{s.address || "—"}</td>
                            <td>{s.provider || "—"}</td>
                            <td>{s.role || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ---- REVIEW: documents ---- */}
            {!structured && walk && !busy && (
              <>
                <div className="vault-btnrow" style={{ marginTop: 12, alignItems: "center" }}>
                  <span className="vault-kind ok">{walk.files.length} will import</span>
                  {walk.skipped > 0 && <span className="vault-kind">{walk.skipped} skipped · not .md/.txt/.pdf</span>}
                  {walk.skippedDirs.length > 0 && <span className="vault-who">skipped folders: {walk.skippedDirs.join(", ")}</span>}
                </div>
                {walk.truncated && (
                  <div className="vault-hint" style={{ marginTop: 8, color: "var(--vault-warn-color)" }}>
                    <b>Capped at {walk.files.length} files.</b> That is a lot for one import — narrow the folder rather than
                    letting a partial list look complete.
                  </div>
                )}
                {walk.files.length > 0 && (
                  <>
                    <div className="vault-filelist">
                      {walk.files.slice(0, 40).map((f: VaultWalkedFile) => (
                        <div key={f.path} className="vault-frow">
                          <span className="vault-kind">{f.ext.slice(1) || "file"}</span>
                          <span className="vault-mono vault-clip" style={{ flex: 1 }}>{f.rel}</span>
                          {/* The file's OWN dates, not today's — this is the column that proves it. */}
                          <span className="vault-who">created {shortDate(f.birthtimeMs)} · edited {shortDate(f.mtimeMs)}</span>
                          <span className="vault-who">{kb(f.size)}</span>
                          <button className="vault-btn sm" title="Leave this one out" onClick={() => dropFile(f.path)}>✕</button>
                        </div>
                      ))}
                      {walk.files.length > 40 && <div className="vault-hint" style={{ padding: "6px 2px" }}>…and {walk.files.length - 40} more.</div>}
                    </div>
                    {/* WHERE THEY LAND. Mirroring rebuilds the tree you already have; the flat
                        option is the old behaviour, kept for a small pile where a tree is noise. */}
                    <label className="vault-mirror">
                      <input type="checkbox" checked={mirror} onChange={(e) => {
                        setMirror(e.target.checked);
                        if (e.target.checked && !folderPreview && walk) {
                          void api.previewFolderPaths(walk.files.map((f) => f.rel)).then(setFolderPreview).catch(() => setFolderPreview([]));
                        }
                      }} />
                      <span>
                        <b>Mirror the folders on disk</b>
                        <span className="vault-hint">
                          Rebuild the source tree inside the vault, so a note is where you would look for it.
                          {folderPreview && folderPreview.length > 0 && <> <b>{folderPreview.length} folders</b> would be created.</>}
                        </span>
                      </span>
                    </label>
                    {!mirror && (
                      <div className="vault-field" style={{ marginTop: 10, maxWidth: 280 }}>
                        <label htmlFor="imp-folder">Put them all in one folder</label>
                        <input id="imp-folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Uncategorised" />
                      </div>
                    )}
                    <div className="vault-hint" style={{ marginTop: 8 }}>
                      Each note keeps <b>the file's own created and edited dates</b> — an old runbook imports as old, not
                      as today. Frontmatter <code>created:</code> or <code>updated:</code> wins when present.
                    </div>
                  </>
                )}
              </>
            )}

            {error && <div className="vault-state error">{error}</div>}

            <div className="vault-modalacts">
              <span className="vault-hint" style={{ marginRight: "auto" }}>
                {structured ? "Parsed on screen first. The original file is not moved or changed."
                  : "Files are copied into the encrypted vault. The originals are not moved or changed."}
              </span>
              <button className="vault-btn" onClick={onClose}>Cancel</button>
              <button className="vault-btn primary" disabled={!canGo} onClick={run}>
                {busy ? "Importing…" : `Import ${count} ${count === 1 ? noun.replace(/s$/, "") : noun}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
