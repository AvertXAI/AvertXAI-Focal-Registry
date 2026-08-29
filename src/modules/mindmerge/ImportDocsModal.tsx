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
// create is on screen before anything is written.
//
// NOTHING IS WRITTEN UNTIL THE COMMIT BUTTON. Every parse is pure and main-side; the review table
// is built from its return value.
//
// MINDMERGE COPY (Phase 4, 08-22-2026). Copied from src/modules/vault/ImportDocsModal.tsx per the
// Phase 4 addendum. The vault file also drives the INFRASTRUCTURE importers (dns → parseZone/
// importZone, servers → parseServers/importServers, and the refusing sshkeys card) — those are
// vault-only surfaces and are STRIPPED from this copy, same entitlement logic as the mindmergeApi
// trim. Only the DOCUMENTS route crosses, verbatim: chooseFiles/chooseFolders/walkFolders/
// statFiles/previewFolderPaths/importDocs, with every count and every reconcile rule kept. The
// strip is itemised in the Phase 4 lane report; a silent strip is a failed lane.
import { useCallback, useEffect, useMemo, useState } from "react";
import Loading from "./Loading";
import { mindmergeApi, type VaultWalkResult, type VaultWalkedFile } from "./mindmergeApi";

// "repos" was DELETED from this union with the mount (08-14-2026): the Repos tab's generic import
// was removed 08-12-2026 (see ReposView.tsx) and the destination had been unreachable since.
// "infra" is STRIPPED in the MindMerge copy (08-22-2026) — infrastructure never crosses.
export type ImportTarget = "notes";

/** Every place a file can land. `docs` is the original note-shaped import. */
type Dest = "auto" | "note" | "runbook" | "snippet" | "docs";

interface DestDef {
  id: Dest;
  title: string;
  blurb: string;
  exts: string;
  /** Present but refusing, with the reason on screen. Unused by any MindMerge destination today —
      the vault's one refusing card (sshkeys) is infra and was stripped — but the machinery is
      generic modal plumbing and is kept so the docs-flow JSX stays verbatim. */
  disabled?: string;
}

const DESTS: Record<ImportTarget, DestDef[]> = {
  notes: [
    { id: "auto", title: "Work it out", blurb: "Read each file and decide from its shape and frontmatter.", exts: ".md · .txt · .pdf" },
    { id: "note", title: "Notes", blurb: "Everything lands as a plain note.", exts: ".md · .txt · .pdf" },
    { id: "runbook", title: "Runbooks", blurb: "Numbered steps get copy buttons and ticks in Run mode.", exts: ".md · .txt" },
    { id: "snippet", title: "Ideas", blurb: "Things you are thinking about — sketches, concepts, fragments.", exts: ".md · .txt" },
  ],
};

const TITLES: Record<ImportTarget, string> = {
  notes: "Import into Documents",
};

type Result = {
  kind: "docs"; scanned: number; created: number; warned: number; skipped: number;
  skippedFiled: number; skippedUnfiled: number; skippedArchived: number;
  failed: number; problems: { file: string; reason: string }[];
};

export default function ImportDocsModal({ target, onClose, onDone }: { target: ImportTarget; onClose: () => void; onDone: () => void }) {
  const api = mindmergeApi();
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const def = useMemo(() => dests.find((d) => d.id === dest) ?? dests[0], [dests, dest]);

  /** Switching destination throws away the previous pick — keeping a stale list on screen is how
      the wrong thing gets imported. */
  const pickDest = (d: Dest): void => {
    setDest(d);
    setWalk(null); setRoots([]); setError(null);
  };

  const chooseFiles = useCallback((): void => {
    setError(null);
    void api.chooseFiles(target)
      .then((picked) => {
        if (picked.length === 0) return; // cancelled — nothing should change on screen
        setBusy(true);
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
  }, [api, target]);

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

  const count = walk?.files.length ?? 0;
  const noun = "files";
  const canGo = count > 0 && !busy && !def?.disabled;

  return (
    <div className="mm-modalback" onClick={onClose}>
      <div className="mm-modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        {/* ONCE IT IS DONE, THE TITLE SAYS SO. Leaving the instruction above a finished result reads
            as an instruction for something already finished, and the "nothing is written yet"
            reassurance is actively untrue by then. */}
        <h3>{result ? `Imported ${result.created} ${result.created === 1 ? noun.replace(/s$/, "") : noun}` : TITLES[target]}</h3>
        <div className="mm-modalsub">
          {result ? "Done — nothing else will be written." : "Nothing is written until you press Import."}
        </div>

        {result ? (
          <>
            <div className="mm-card" style={{ margin: "6px 0 0", background: "var(--mc-nested)" }}>
              <div className="mm-cardtitle" style={{ color: "var(--mm-strong-color)", marginBottom: 8 }}>
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
                <div className="mm-hint" style={{ marginBottom: 8 }}>
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
                <div className="mm-hint" style={{ marginBottom: 8 }}>
                  The <b>{result.skipped.toLocaleString()} already here</b> were left alone — importing the same folder
                  twice adds what is new instead of a second copy of everything. Where those notes are now:
                  <ul className="mm-reasons" style={{ marginTop: 6 }}>
                    <li><b>{result.skippedFiled.toLocaleString()}</b> filed in folders — this is the number the sidebar counts.</li>
                    {result.skippedUnfiled > 0 && (
                      <li><b>{result.skippedUnfiled.toLocaleString()}</b> unfiled — in MindMerge, in no folder.</li>
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
                  <div className="mm-hint">
                    {result.warned} had a frontmatter block that could not be read. <b>They were imported anyway</b>, with the
                    text kept and a warning line at the top — a file that will not parse is never thrown away.
                  </div>
                  <ul className="mm-reasons" style={{ marginTop: 8 }}>
                    {result.problems.slice(0, 10).map((p) => (<li key={p.file}><b>{p.file}</b> — {p.reason}</li>))}
                    {result.problems.length > 10 && <li>…and {result.problems.length - 10} more.</li>}
                  </ul>
                </>
              ) : (
                <div className="mm-hint">Every file came across cleanly.</div>
              )}
            </div>
            <div className="mm-modalacts"><button className="mm-btn primary" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            {/* WHERE IT GOES, chosen before anything is read. */}
            <div className="mm-dests">
              {dests.map((d) => (
                <button key={d.id} className={`mm-dcard${dest === d.id ? " on" : ""}${d.disabled ? " off" : ""}`} onClick={() => pickDest(d.id)}>
                  <b>{d.title}</b>
                  <span>{d.blurb}</span>
                  <span className="ex">{d.exts}</span>
                </button>
              ))}
            </div>

            {def?.disabled ? (
              <div className="mm-state" style={{ textAlign: "left" }}>{def.disabled}</div>
            ) : (
              <>
                <button className="mm-drop" onClick={chooseFiles} disabled={busy}>
                  <b>Choose files</b>
                  <span className="mm-hint" style={{ display: "block", marginTop: 5 }}>
                    One or several — they add up if you choose twice.
                  </span>
                </button>
                {/* FILE OR FOLDER, ON EVERY TAB (Jason 08-11-2026). */}
                <div className="mm-btnrow" style={{ marginTop: 9, justifyContent: "center" }}>
                  <button className="mm-btn" onClick={chooseFolders} disabled={busy}>…or choose a whole folder</button>
                </div>
              </>
            )}

            {roots.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="mm-cardtitle" style={{ marginBottom: 8 }}>{roots.length} folder{roots.length === 1 ? "" : "s"} chosen</div>
                {roots.map((r) => (
                  <div key={r} className="mm-folderline">
                    <span>📁</span>
                    <span className="mm-mono mm-clip" style={{ flex: 1 }}>{r}</span>
                    <button className="mm-btn sm danger" onClick={() => dropRoot(r)}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {busy && !result && (
              <Loading compact message={count > 0 ? `Importing ${count} ${noun}…` : "Reading…"} />
            )}

            {/* ---- REVIEW: documents ---- */}
            {walk && !busy && (
              <>
                <div className="mm-btnrow" style={{ marginTop: 12, alignItems: "center" }}>
                  <span className="mm-kind ok">{walk.files.length} will import</span>
                  {walk.skipped > 0 && <span className="mm-kind">{walk.skipped} skipped · not .md/.txt/.pdf</span>}
                  {walk.skippedDirs.length > 0 && <span className="mm-who">skipped folders: {walk.skippedDirs.join(", ")}</span>}
                </div>
                {walk.truncated && (
                  <div className="mm-hint" style={{ marginTop: 8, color: "var(--mm-warn-color)" }}>
                    <b>Capped at {walk.files.length} files.</b> That is a lot for one import — narrow the folder rather than
                    letting a partial list look complete.
                  </div>
                )}
                {walk.files.length > 0 && (
                  <>
                    <div className="mm-filelist">
                      {walk.files.slice(0, 40).map((f: VaultWalkedFile) => (
                        <div key={f.path} className="mm-frow">
                          <span className="mm-kind">{f.ext.slice(1) || "file"}</span>
                          <span className="mm-mono mm-clip" style={{ flex: 1 }}>{f.rel}</span>
                          {/* The file's OWN dates, not today's — this is the column that proves it. */}
                          <span className="mm-who">created {shortDate(f.birthtimeMs)} · edited {shortDate(f.mtimeMs)}</span>
                          <span className="mm-who">{kb(f.size)}</span>
                          <button className="mm-btn sm" title="Leave this one out" onClick={() => dropFile(f.path)}>✕</button>
                        </div>
                      ))}
                      {walk.files.length > 40 && <div className="mm-hint" style={{ padding: "6px 2px" }}>…and {walk.files.length - 40} more.</div>}
                    </div>
                    {/* WHERE THEY LAND. Mirroring rebuilds the tree you already have; the flat
                        option is the old behaviour, kept for a small pile where a tree is noise. */}
                    <label className="mm-mirror">
                      <input type="checkbox" checked={mirror} onChange={(e) => {
                        setMirror(e.target.checked);
                        if (e.target.checked && !folderPreview && walk) {
                          void api.previewFolderPaths(walk.files.map((f) => f.rel)).then(setFolderPreview).catch(() => setFolderPreview([]));
                        }
                      }} />
                      <span>
                        <b>Mirror the folders on disk</b>
                        <span className="mm-hint">
                          Rebuild the source tree inside MindMerge, so a note is where you would look for it.
                          {folderPreview && folderPreview.length > 0 && <> <b>{folderPreview.length} folders</b> would be created.</>}
                        </span>
                      </span>
                    </label>
                    {!mirror && (
                      <div className="mm-field" style={{ marginTop: 10, maxWidth: 280 }}>
                        <label htmlFor="imp-folder">Put them all in one folder</label>
                        <input id="imp-folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Uncategorised" />
                      </div>
                    )}
                    <div className="mm-hint" style={{ marginTop: 8 }}>
                      Each note keeps <b>the file's own created and edited dates</b> — an old runbook imports as old, not
                      as today. Frontmatter <code>created:</code> or <code>updated:</code> wins when present.
                    </div>
                  </>
                )}
              </>
            )}

            {error && <div className="mm-state error">{error}</div>}

            <div className="mm-modalacts">
              <span className="mm-hint" style={{ marginRight: "auto" }}>
                Files are copied into MindMerge. The originals are not moved or changed.
              </span>
              <button className="mm-btn" onClick={onClose}>Cancel</button>
              <button className="mm-btn primary" disabled={!canGo} onClick={run}>
                {busy ? "Importing…" : `Import ${count} ${count === 1 ? noun.replace(/s$/, "") : noun}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
