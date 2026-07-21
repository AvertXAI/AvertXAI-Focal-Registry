// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Rename module UI. Four tabs per the approved MOCKUP-rename-module-3: New batch, Revert
//              (purple), History, Presets. Talks to the engine ONLY via window.api.rename; the LIVE
//              preview is the ONE pure buildPreview() from src/shared/renamePreview run locally on
//              every keystroke over the files gathered once per source-folder change. Copies only —
//              the UI states it plainly and never implies an in-place rename. Long jobs stream over
//              rename:progress and a running batch rejoins on mount.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: src/modules/rename/RenameModule.tsx
//------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RenameBatchRow, RenamePresetRow, RenameProgress, RenameRevertRow } from "../../shared/types";
import { buildPreview, type RenameSettings, type RenameSourceFile } from "../../shared/renamePreview";
import { formatStamp } from "../../shared/datetime";
import "./rename.css";

type Tab = "new" | "revert" | "history" | "presets";
const MAX_PREVIEW_ROWS = 200; // render the head only — a 100k-file batch must not build 100k DOM rows

// The example start value for a pad width: 01 (2) · 001 (3) · 0001 (4) — the reset default on pad change.
const seqExample = (pad: number): string => "1".padStart(Math.max(1, pad || 1), "0");

// Dates are entered MMDDYYYY and shown as "June 5, 2026" — never YYYYMMDD, never numeric slashes.
function parseMMDDYYYY(s: string | null): Date | null {
  const d = (s ?? "").replace(/\D/g, "");
  if (d.length !== 8) return null;
  const mm = +d.slice(0, 2), dd = +d.slice(2, 4), yyyy = +d.slice(4, 8);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const dt = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
const fmtShootDate = (s: string | null): string => {
  const dt = parseMMDDYYYY(s);
  return dt ? dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : (s?.trim() ? s : "—");
};

const DEFAULT_SETTINGS: RenameSettings = {
  prefixMode: "both", businessName: "", photographerName: "", sequenceStart: 1, sequencePad: 3,
  clientName: "", projectName: "", shootDate: "", customTag: "",
};

const fmtInt = (n: number): string => n.toLocaleString();

export default function RenameModule() {
  const api = window.api.rename;
  const [tab, setTab] = useState<Tab>("new");
  const [error, setError] = useState<string | null>(null);

  // ---- New-batch state ----
  const [sources, setSources] = useState<string[]>([]);
  const [destination, setDestination] = useState("");
  const [settings, setSettings] = useState<RenameSettings>(DEFAULT_SETTINGS);
  const [files, setFiles] = useState<RenameSourceFile[]>([]);
  const [gathering, setGathering] = useState(false);

  // ---- run progress (shared by rename + revert) ----
  const [progress, setProgress] = useState<RenameProgress | null>(null);
  const running = progress?.status === "running";

  // ---- history / revert / presets ----
  const [batches, setBatches] = useState<RenameBatchRow[]>([]);
  const [presets, setPresets] = useState<RenamePresetRow[]>([]);
  const [revBatchId, setRevBatchId] = useState<number | null>(null);
  const [copiesFolder, setCopiesFolder] = useState("");
  const [revertDest, setRevertDest] = useState("");
  const [revertRows, setRevertRows] = useState<RenameRevertRow[]>([]);

  const [toast, setToast] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [loadedPresetId, setLoadedPresetId] = useState<number | null>(null); // the currently-loaded business profile
  const [seqRaw, setSeqRaw] = useState(seqExample(3)); // the raw sequence-start text (free editing)
  const [seqGlow, setSeqGlow] = useState(false); // glow the start field after a pad change
  const [summary, setSummary] = useState<{ kind: "rename" | "revert"; folder: string; copied: number; skipped: number; errored: number } | null>(null);
  const lastOp = useRef<{ kind: "rename" | "revert"; folder: string } | null>(null);

  const set = useCallback(<K extends keyof RenameSettings>(k: K, v: RenameSettings[K]) => setSettings((s) => ({ ...s, [k]: v })), []);

  const refreshBatches = useCallback(async () => {
    try { setBatches(await api.listBatches()); } catch (e) { setError(String(e)); }
  }, [api]);
  const refreshPresets = useCallback(async () => {
    try { setPresets(await api.listPresets()); } catch (e) { setError(String(e)); }
  }, [api]);

  const applyPreset = useCallback((p: RenamePresetRow) => {
    const pad = p.sequence_pad ?? 3;
    const start = p.sequence_start ?? 1;
    setSettings({
      prefixMode: (p.prefix_mode as RenameSettings["prefixMode"]) || "both",
      businessName: p.business_name ?? "", photographerName: p.photographer_name ?? "",
      sequenceStart: start, sequencePad: pad,
      clientName: p.client_name ?? "", projectName: p.project_name ?? "", shootDate: "", customTag: p.custom_tag ?? "",
    });
    setSeqRaw(String(start).padStart(pad, "0"));
  }, []);

  // Toast auto-dismiss.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Mount: load batches + presets, restore the last-used preset, and rejoin a running batch.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [bs, ps] = await Promise.all([api.listBatches(), api.listPresets()]).catch(() => [[], []] as [RenameBatchRow[], RenamePresetRow[]]);
      if (!alive) return;
      setBatches(bs);
      setPresets(ps);
      const last = ps.find((p) => p.is_last_used === 1);
      if (last) applyPreset(last);
      const live = bs.find((b) => b.status === "running");
      if (live) setProgress({ batchId: live.id, status: "running", currentFile: null, total: 0, copied: live.files_copied, skipped: live.files_skipped, errored: live.files_errored });
    })();
    return () => { alive = false; };
  }, [api, applyPreset]);

  // Progress push (rename + revert share the channel).
  useEffect(() => {
    const onP = (p: RenameProgress): void => {
      setProgress(p);
      if (p.status === "error" && p.error) setError(p.error);
      if (p.status !== "running") {
        void refreshBatches();
        if (p.status === "completed" && lastOp.current) {
          setSummary({ kind: lastOp.current.kind, folder: lastOp.current.folder, copied: p.copied, skipped: p.skipped, errored: p.errored });
        }
      }
    };
    window.api.on<RenameProgress>("rename:progress", onP);
    return () => window.api.off<RenameProgress>("rename:progress", onP);
  }, [refreshBatches]);

  // Gather the source folders' files whenever the source set changes (one FS walk; the preview is pure).
  useEffect(() => {
    if (sources.length === 0) { setFiles([]); return; }
    let alive = true;
    setGathering(true);
    void api.gather(sources).then((f) => { if (alive) setFiles(f); }).catch((e) => { if (alive) setError(String(e)); }).finally(() => { if (alive) setGathering(false); });
    return () => { alive = false; };
  }, [api, sources]);

  // LIVE preview — pure, recomputed on every settings keystroke (no FS, no IPC).
  const preview = useMemo(() => buildPreview(files, settings), [files, settings]);
  const counts = useMemo(() => {
    let image = 0, video = 0, audio = 0;
    for (const f of files) f.mediaClass === "image" ? image++ : f.mediaClass === "video" ? video++ : audio++;
    return { total: files.length, image, video, audio };
  }, [files]);

  const addFolder = async (): Promise<void> => {
    const dir = await api.pickFolder("Choose a source folder");
    if (!dir) return;
    if (await api.isDriveRoot(dir)) { setError(`"${dir}" is a drive root — choose a folder inside the drive.`); return; }
    setSources((s) => (s.includes(dir) ? s : [...s, dir]));
  };
  const pickDestination = async (): Promise<void> => {
    const dir = await api.pickFolder("Choose the destination folder");
    if (dir) setDestination(dir);
  };

  const runRename = async (): Promise<void> => {
    setError(null);
    lastOp.current = { kind: "rename", folder: destination };
    const res = await api.start({ sources, destination, settings });
    if (!res.ok) setError(res.error ?? "Could not start.");
    else { setProgress({ batchId: 0, status: "running", currentFile: null, total: preview.length, copied: 0, skipped: 0, errored: 0 }); void refreshBatches(); }
  };

  // ---- Revert flow ----
  const selectRevertBatch = async (id: number): Promise<void> => {
    setRevBatchId(id);
    const b = batches.find((x) => x.id === id);
    if (b) setCopiesFolder(b.destination_path);
    try { setRevertRows(await api.revertMapping(id)); } catch (e) { setError(String(e)); }
  };
  const gotoRevert = (id: number): void => { setTab("revert"); void selectRevertBatch(id); };
  const runRevert = async (): Promise<void> => {
    if (revBatchId == null) { setError("Choose a batch to revert."); return; }
    setError(null);
    lastOp.current = { kind: "revert", folder: revertDest };
    const res = await api.startRevert({ batchId: revBatchId, copiesFolder, destination: revertDest });
    if (!res.ok) setError(res.error ?? "Could not start the revert.");
    else setProgress({ batchId: 0, status: "running", currentFile: null, total: revertRows.length, copied: 0, skipped: 0, errored: 0 });
  };

  const saveProfileNew = async (): Promise<void> => {
    const name = presetName.trim();
    if (!name) return;
    await api.savePreset(name, settings);
    const fresh = await api.listPresets();
    setPresets(fresh);
    const saved = fresh.find((p) => p.name === name);
    if (saved) setLoadedPresetId(saved.id); // the new profile becomes the loaded one
    setPresetName("");
    setToast(`Profile "${name}" saved`);
  };
  const updateProfile = async (): Promise<void> => {
    if (loadedPresetId == null) return;
    const cur = presets.find((p) => p.id === loadedPresetId);
    if (!cur) return;
    await api.savePreset(cur.name, settings); // savePreset replaces by name
    setPresets(await api.listPresets());
    setToast(`Profile "${cur.name}" updated`);
  };

  const prefixPreview = useMemo(() => {
    const b = settings.businessName.trim() || "Business";
    const p = settings.photographerName.trim() || "Photographer";
    return settings.prefixMode === "photo" ? p : settings.prefixMode === "biz" ? b : `${b}-${p}`;
  }, [settings]);
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round(((progress.copied + progress.skipped + progress.errored) / progress.total) * 100)) : 0;

  const renameOnly = batches.filter((b) => b.kind === "rename");
  // Business profiles = named presets ("(last used)" is the internal auto-restore row, hidden from the list).
  const namedPresets = presets.filter((p) => p.name !== "(last used)");
  const loadedPreset = presets.find((p) => p.id === loadedPresetId) ?? null;
  const profileDirty = loadedPreset != null && !(
    (loadedPreset.prefix_mode ?? "both") === settings.prefixMode &&
    (loadedPreset.business_name ?? "") === settings.businessName &&
    (loadedPreset.photographer_name ?? "") === settings.photographerName &&
    (loadedPreset.sequence_start ?? 1) === settings.sequenceStart &&
    (loadedPreset.sequence_pad ?? 3) === settings.sequencePad &&
    (loadedPreset.client_name ?? "") === settings.clientName &&
    (loadedPreset.project_name ?? "") === settings.projectName &&
    (loadedPreset.custom_tag ?? "") === settings.customTag
  );

  return (
    <main className="view shown">
      <div className="wrap rename-shell">
        <h1 className="pagetitle">Rename</h1>
        <p className="subtitle">Copies files to a destination with new names. Never renames, moves, or deletes an original.</p>

        <div className="rn-tabs">
          {([["new", "New batch"], ["revert", "Revert"], ["history", "History"], ["presets", "Profiles"]] as [Tab, string][]).map(([t, label]) => (
            <button key={t} className={`rn-tab${t === "revert" ? " rev" : ""}${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
              {t === "revert" && <span className="rn-tabdot" />}{label}
            </button>
          ))}
        </div>

        {error && <div className="rn-error" onClick={() => setError(null)}>{error}</div>}

        {tab === "new" && (
          <div className="rn-split">
            <div className="rn-left">
              <div className="rn-lbl">Source folders</div>
              {sources.map((s, i) => (
                <div className="rn-row" key={s}>
                  <input className="rn-inp mono" value={s} readOnly title={s} />
                  <button className="rn-btn" onClick={() => setSources((x) => x.filter((_, j) => j !== i))} aria-label="Remove folder">✕</button>
                </div>
              ))}
              <div className="rn-row"><button className="rn-btn" style={{ width: "100%" }} onClick={() => void addFolder()}>＋ Add another folder</button></div>
              <div className="rn-hint">Each folder plus its subfolders. Never a drive root. The sequence runs continuously across every folder.</div>

              <div className="rn-lbl">Destination</div>
              <div className="rn-row"><input className="rn-inp mono" value={destination} readOnly placeholder="Choose a folder…" /><button className="rn-btn" onClick={() => void pickDestination()}>Browse</button></div>

              <div className="rn-lbl">Prefix</div>
              <div className="rn-seg">
                {([["photo", "Photographer"], ["biz", "Business"], ["both", "Both"]] as [RenameSettings["prefixMode"], string][]).map(([m, label]) => (
                  <div key={m} className={settings.prefixMode === m ? "on" : ""} onClick={() => set("prefixMode", m)}>{label}</div>
                ))}
              </div>
              <div className="rn-row"><input className="rn-inp mono" value={settings.businessName} placeholder="Business" onChange={(e) => set("businessName", e.target.value)} /></div>
              <div className="rn-row"><input className="rn-inp mono" value={settings.photographerName} placeholder="Photographer" onChange={(e) => set("photographerName", e.target.value)} /></div>

              <div className="rn-lbl">Sequence</div>
              <div className="rn-row">
                <input className={`rn-inp mono${seqGlow ? " rn-glow" : ""}`} style={{ maxWidth: 110 }} value={seqRaw}
                  onChange={(e) => { const raw = e.target.value.replace(/\D/g, "").slice(0, 6); setSeqRaw(raw); setSeqGlow(false); set("sequenceStart", raw === "" ? 1 : parseInt(raw, 10)); }} />
                <select className="rn-inp" value={settings.sequencePad}
                  onChange={(e) => { const pad = Number(e.target.value); set("sequencePad", pad); set("sequenceStart", 1); setSeqRaw(seqExample(pad)); setSeqGlow(true); }}>
                  <option value={2}>2 digits</option><option value={3}>3 digits</option><option value={4}>4 digits</option>
                </select>
              </div>
              <div className="rn-hint"><b>Each file type counts separately.</b> Stills, video, and audio each run their own 001, 002… A RAW + JPEG pair shares one number.
                {seqGlow && <span style={{ color: "var(--rename-accent)" }}> Start reset to {seqExample(settings.sequencePad)} — edit it or keep the default.</span>}</div>

              <div className="rn-lbl">Business profile &amp; client info <span className="rn-tagdb">saved to database</span></div>
              <div className="rn-row">
                <select className="rn-inp" value={loadedPresetId ?? ""}
                  onChange={(e) => { const p = namedPresets.find((x) => x.id === Number(e.target.value)); if (p) { applyPreset(p); setLoadedPresetId(p.id); } else setLoadedPresetId(null); }}>
                  <option value="">Load a saved profile…</option>
                  {namedPresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="rn-row"><input className="rn-inp" value={settings.clientName} placeholder="Client name" onChange={(e) => set("clientName", e.target.value)} /></div>
              <div className="rn-row"><input className="rn-inp" value={settings.projectName} placeholder="Project / event name" onChange={(e) => set("projectName", e.target.value)} /></div>
              <div className="rn-row">
                <input className="rn-inp mono" style={{ maxWidth: 150 }} value={settings.shootDate} placeholder="Date (MMDDYYYY)" onChange={(e) => set("shootDate", e.target.value.replace(/\D/g, "").slice(0, 8))} />
                <input className="rn-inp" value={settings.customTag} placeholder="Custom tag (optional)" onChange={(e) => set("customTag", e.target.value)} />
              </div>
              <div className="rn-hint">A profile saves your business, photographer, sequence, and client info — load one and it all fills in. The shoot date is per-shoot.{parseMMDDYYYY(settings.shootDate) && <span> Shoot date: <b>{fmtShootDate(settings.shootDate)}</b>.</span>}</div>
              <div className="rn-row">
                <input className="rn-inp" placeholder="Name this profile…" value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveProfileNew(); }} />
                <button className="rn-btn" disabled={!presetName.trim()} onClick={() => void saveProfileNew()}>Save as profile</button>
              </div>
              {loadedPreset && profileDirty && (
                <div className="rn-row"><button className="rn-btn primary" style={{ width: "100%" }} onClick={() => void updateProfile()}>Update &ldquo;{loadedPreset.name}&rdquo; with these changes</button></div>
              )}
              <div className="rn-hint">Your last settings are restored automatically on open.</div>

              <div className="rn-lbl">Result</div>
              <div className="rn-pattern"><b>{prefixPreview}</b>-<b>{String(settings.sequenceStart).padStart(settings.sequencePad, "0")}</b>-<span className="orig">{files[0]?.filename ?? "original-name.CR3"}</span></div>
            </div>

            <div className="rn-rp">
              <div className="rn-warn"><b>Copies only.</b> Every original stays byte-identical. Both names are written to the database, so any batch can be reversed from the Revert tab.</div>
              <div className="rn-pvhead">
                <h2>Preview</h2>
                <span className="rn-count">{fmtInt(counts.total)} files</span>
                {counts.image > 0 && <span className="rn-count cr">{fmtInt(counts.image)} stills</span>}
                {counts.video > 0 && <span className="rn-count mv">{fmtInt(counts.video)} video</span>}
                {counts.audio > 0 && <span className="rn-count">{fmtInt(counts.audio)} audio</span>}
                {gathering && <span className="rn-count">reading folders…</span>}
              </div>
              <div className="rn-pvwrap">
                <table className="rn-tbl">
                  <colgroup><col style={{ width: "34%" }} /><col style={{ width: 32 }} /><col style={{ width: "51%" }} /><col style={{ width: "15%" }} /></colgroup>
                  <thead><tr><th>Original filename</th><th /><th>New filename</th><th>Status</th></tr></thead>
                  <tbody>
                    {preview.slice(0, MAX_PREVIEW_ROWS).map((r) => (
                      <tr key={r.path}>
                        <td title={r.filename}>{r.filename}</td>
                        <td className="rn-arrow">→</td>
                        <td className="rn-new" title={r.copyFilename}><b>{r.copyFilename.slice(0, r.copyFilename.length - r.filename.length - 1)}</b>-{r.filename}</td>
                        <td>{r.status === "batch-dupe" ? <span className="rn-pill warn">name clash</span> : <span className="rn-pill ok">will copy</span>}</td>
                      </tr>
                    ))}
                    {preview.length > MAX_PREVIEW_ROWS && (
                      <tr><td colSpan={4} className="rn-more">…{fmtInt(preview.length - MAX_PREVIEW_ROWS)} more — the sequence continues across every folder, it does not restart</td></tr>
                    )}
                    {preview.length === 0 && <tr><td colSpan={4} className="rn-more">Add a source folder to see the preview.</td></tr>}
                  </tbody>
                </table>
              </div>
              {running && <div className="rn-bar"><i style={{ width: `${pct}%`, background: "var(--rename-primary)" }} /></div>}
              <div className="rn-foot">
                <button className="rn-btn primary" disabled={running || preview.length === 0 || !destination} onClick={() => void runRename()}>
                  {running ? `Copying… ${pct}%` : `▶ Copy & rename ${fmtInt(preview.length)} files`}
                </button>
                <span className="rn-msg">
                  {progress?.status === "completed" ? `${fmtInt(progress.copied)} copied · ${fmtInt(progress.skipped)} skipped · originals untouched · logged to History`
                    : running ? `Copying ${fmtInt(progress!.copied)} of ${fmtInt(progress!.total)}…`
                    : "Ready — preview updates as you type."}
                </span>
              </div>
            </div>
          </div>
        )}

        {tab === "revert" && (
          <div className="rn-split">
            <div className="rn-left">
              <div className="rn-lbl">Which batch</div>
              <div className="rn-row">
                <select className="rn-inp" value={revBatchId ?? ""} onChange={(e) => void selectRevertBatch(Number(e.target.value))}>
                  <option value="">Choose a batch…</option>
                  {renameOnly.map((b) => <option key={b.id} value={b.id}>{(b.project_name || "Untitled")} — {(b.client_name || "—")} · {fmtInt(b.files_copied)} files</option>)}
                </select>
              </div>
              <div className="rn-hint">Every batch you have ever run is listed. Search by client or project in the History tab.</div>

              <div className="rn-lbl">Files to revert</div>
              <div className="rn-row"><input className="rn-inp mono" value={copiesFolder} readOnly placeholder="Where the copies are…" /><button className="rn-btn" onClick={async () => { const d = await api.pickFolder("Where the copies are"); if (d) setCopiesFolder(d); }}>Browse</button></div>
              <div className="rn-hint">Defaults to where the batch was written. Point it elsewhere if you moved or re-copied the files.</div>

              <div className="rn-lbl">Copy reverted files to</div>
              <div className="rn-row"><input className="rn-inp mono" value={revertDest} readOnly placeholder="A fresh destination…" /><button className="rn-btn" onClick={async () => { const d = await api.pickFolder("Copy reverted files to"); if (d) setRevertDest(d); }}>Browse</button></div>
              <div className="rn-hint">A fresh copy is made here with original names restored. Nothing you already have is renamed, moved, or deleted.</div>
            </div>
            <div className="rn-rp">
              <div className="rn-info"><b>This is how you get the original names back.</b> Focal Registry stores the original filename beside the new one for every file it copies. Point this at the renamed copies and it produces a fresh set carrying the names they started with. Nothing is overwritten and nothing is deleted — you end up with both.</div>
              <div className="rn-pvhead"><h2>Revert preview</h2><span className="rn-count pu">{fmtInt(revertRows.length)} files</span><span className="rn-count">from the batch log</span></div>
              <div className="rn-pvwrap">
                <table className="rn-tbl">
                  <colgroup><col style={{ width: "51%" }} /><col style={{ width: 32 }} /><col style={{ width: "34%" }} /><col style={{ width: "15%" }} /></colgroup>
                  <thead><tr><th>Current filename</th><th /><th>Restored to</th><th>Status</th></tr></thead>
                  <tbody>
                    {revertRows.slice(0, MAX_PREVIEW_ROWS).map((r) => (
                      <tr key={r.copy_filename}><td className="rn-new" title={r.copy_filename}><b className="pu">{r.copy_filename}</b></td><td className="rn-arrow">→</td><td title={r.source_filename}>{r.source_filename}</td><td><span className="rn-pill rst">will restore</span></td></tr>
                    ))}
                    {revertRows.length > MAX_PREVIEW_ROWS && <tr><td colSpan={4} className="rn-more">…{fmtInt(revertRows.length - MAX_PREVIEW_ROWS)} more, every one matched against the batch log</td></tr>}
                    {revertRows.length === 0 && <tr><td colSpan={4} className="rn-more">Choose a batch to see its reverse mapping.</td></tr>}
                  </tbody>
                </table>
              </div>
              {running && <div className="rn-bar"><i style={{ width: `${pct}%`, background: "var(--rename-accent)" }} /></div>}
              <div className="rn-foot">
                <button className="rn-btn rev" disabled={running || revBatchId == null || !revertDest} onClick={() => void runRevert()}>{running ? `Restoring… ${pct}%` : `⟲ Copy ${fmtInt(revertRows.length)} files with original names`}</button>
                <span className="rn-msg">{progress?.status === "completed" ? `${fmtInt(progress.copied)} restored · the renamed copies are still there · nothing deleted` : "Ready — nothing has been written."}</span>
              </div>
            </div>
          </div>
        )}

        {tab === "history" && <History batches={batches} onRevert={gotoRevert} onOpen={(p) => void api.openFolder(p)} />}
        {tab === "presets" && <Presets presets={namedPresets} onApply={(p) => { applyPreset(p); setLoadedPresetId(p.id); setTab("new"); }} onDelete={async (id) => { await api.deletePreset(id); void refreshPresets(); if (loadedPresetId === id) setLoadedPresetId(null); setToast("Profile deleted"); }} />}
      </div>

      {summary && (
        <div className="rn-modal-back" onClick={() => setSummary(null)}>
          <div className="rn-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{summary.kind === "rename" ? "Copy complete" : "Revert complete"}</h3>
            <p>
              {summary.kind === "rename"
                ? `${fmtInt(summary.copied)} file${summary.copied === 1 ? "" : "s"} copied${summary.skipped ? `, ${fmtInt(summary.skipped)} skipped` : ""}${summary.errored ? `, ${fmtInt(summary.errored)} errored` : ""}. Every original is byte-identical and untouched.`
                : `${fmtInt(summary.copied)} file${summary.copied === 1 ? "" : "s"} restored with their original names${summary.skipped ? `, ${fmtInt(summary.skipped)} skipped` : ""}${summary.errored ? `, ${fmtInt(summary.errored)} not found` : ""}. The renamed copies are still there — nothing was deleted.`}
            </p>
            <div className="rn-modal-path" title={summary.folder}>{summary.folder}</div>
            <div className="rn-row" style={{ marginTop: 4 }}>
              <button className="rn-btn primary" onClick={() => void api.openFolder(summary.folder)}>Open folder location</button>
              <button className="rn-btn" onClick={() => setSummary(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="rn-toast" role="status">{toast}</div>}
    </main>
  );
}

function History({ batches, onRevert, onOpen }: { batches: RenameBatchRow[]; onRevert: (id: number) => void; onOpen: (p: string) => void }) {
  const [samples, setSamples] = useState<Record<number, { source_filename: string; copy_filename: string | null }[]>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<number, { source_filename: string; copy_filename: string | null }[]> = {};
      for (const b of batches.slice(0, 20)) out[b.id] = await window.api.rename.batchSample(b.id);
      if (alive) setSamples(out);
    })();
    return () => { alive = false; };
  }, [batches]);
  if (batches.length === 0) return <div className="rn-empty">No batches yet. Copy a batch and it appears here — every one is reversible.</div>;
  return (
    <div className="rn-hist">
      {batches.map((b) => b.kind === "revert" ? (
        // Revert entries are view-only — a record that it happened, with no further actions.
        <div className="rn-batch rn-batch-rev" key={b.id}>
          <div className="rn-batchtop"><h3>Reverted — {b.client_name || b.project_name || "batch"}</h3><span className="rn-count pu">revert</span><span className="rn-when">{formatStamp(b.finished_at ?? b.created_at, "eventTime")}</span></div>
          <div className="rn-meta">
            <div><span>Restored</span><b>{fmtInt(b.files_copied)}</b></div><div><span>Skipped</span><b>{fmtInt(b.files_skipped)}</b></div>
            <div><span>Not found</span><b>{fmtInt(b.files_errored)}</b></div><div><span>Restored to</span><b title={b.destination_path}>{b.destination_path}</b></div>
          </div>
        </div>
      ) : (
        <div className="rn-batch" key={b.id}>
          <div className="rn-batchtop"><h3>{b.project_name || "Untitled"} — {b.client_name || "—"}</h3><span className="rn-count">{fmtInt(b.files_copied)} files</span><span className="rn-when">{formatStamp(b.finished_at ?? b.created_at, "eventTime")}</span></div>
          <div className="rn-meta">
            <div><span>Client</span><b>{b.client_name || "—"}</b></div><div><span>Project</span><b>{b.project_name || "—"}</b></div>
            <div><span>Shoot date</span><b>{fmtShootDate(b.shoot_date)}</b></div><div><span>Prefix</span><b>{b.prefix_mode === "both" ? `${b.business_name}-${b.photographer_name}` : b.prefix_mode === "biz" ? b.business_name : b.photographer_name}</b></div>
            <div><span>Stills</span><b>{fmtInt(b.image_count)}</b></div><div><span>Video</span><b>{fmtInt(b.video_count)}</b></div>
            <div><span>Skipped</span><b>{fmtInt(b.files_skipped)}</b></div><div><span>Destination</span><b title={b.destination_path}>{b.destination_path}</b></div>
          </div>
          {(samples[b.id]?.length ?? 0) > 0 && (
            <div className="rn-sample">{samples[b.id].map((s, i) => (<div key={i}>{s.source_filename} → <b>{s.copy_filename}</b></div>))}</div>
          )}
          <div className="rn-row" style={{ marginTop: 12 }}>
            <button className="rn-btn rev" onClick={() => onRevert(b.id)}>⟲ Revert this batch</button>
            <button className="rn-btn" onClick={() => onOpen(b.destination_path)}>Open destination</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Presets({ presets, onApply, onDelete }: { presets: RenamePresetRow[]; onApply: (p: RenamePresetRow) => void; onDelete: (id: number) => void }) {
  return (
    <div className="rn-hist">
      <div className="rn-info">Business profiles — your business, photographer, sequence, and client info in one saved set. Load one from the New batch tab and everything fills in. Create or update them there.</div>
      {presets.length === 0 && <div className="rn-empty">No profiles yet. On New batch, fill in your info and hit “Save as profile.”</div>}
      {presets.map((p) => (
        <div className="rn-batch" key={p.id}>
          <div className="rn-batchtop"><h3>{p.name}</h3></div>
          <div className="rn-meta">
            <div><span>Business</span><b>{p.business_name || "—"}</b></div><div><span>Photographer</span><b>{p.photographer_name || "—"}</b></div>
            <div><span>Client</span><b>{p.client_name || "—"}</b></div><div><span>Project</span><b>{p.project_name || "—"}</b></div>
            <div><span>Prefix</span><b>{p.prefix_mode}</b></div><div><span>Start / pad</span><b>{p.sequence_start ?? 1} / {p.sequence_pad ?? 3}</b></div>
          </div>
          <div className="rn-row" style={{ marginTop: 12 }}>
            <button className="rn-btn primary" onClick={() => onApply(p)}>Load</button>
            <button className="rn-btn" onClick={() => onDelete(p.id)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
