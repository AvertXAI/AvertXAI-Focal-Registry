/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// MindMerge section for the SHARED Settings surface — added 08-21-2026 on Jason's ruling: "so for
// secured notes to mind merge, in settings, add a section for mind merge, even if there isnt
// anything for settings of mindmerge, we'll just keep it there for now."
//
// It is DELIBERATELY SMALL, and that is the whole brief. Rendered by src/views/Settings.tsx exactly
// the way TimeTrackerSettings and VaultSettings are; living in the module folder keeps the lane
// clean, same as those two.
//
// WHY THERE ARE NO TOGGLES HERE. Every MindMerge key on the RENDERER_KEYS whitelist already has a
// live home inside the module itself — watch_path / watch_enabled / rail_collapsed / font_size on
// the Brain tab, and docs_style / docs_list_collapsed / docs_editor_mode / docs_tab inside the
// Documents view. Mirroring them here would create a second writer for the same rows, and inventing
// new ones would put controls on screen that persist nothing. A control is live iff its action can
// be made real, so what this section carries today is the ONE thing that is real and has nowhere
// else to be shown: the entitlement that decides whether the Documents surface exists at all.
//
// The entitlement is READ here, never written. A licence key changes through the validated licence
// field (Settings → TimeTracker → Licence), which is the same app_settings row this reads back
// through resolveTier(). This surface hiding a tab is a courtesy; the refusal is main-side in
// electron/core/services/mindmerge/ipc.ts.
import { useEffect, useState } from "react";
import type { LicenseFeatureState } from "../../shared/types";

/**
 * THE WATCHER'S CONTROLS LIVE HERE NOW (BL-58 final form, 08-25-2026). The module's status strip
 * lost its toggle and its click-to-pick path by ruling - the strip shows path and count, nothing
 * else - so Settings became the one writer for both rows. Writes go through the SAME sanctioned
 * settings channel the module root uses (window.api.settings.set), so there is no second pathway,
 * just a relocated control. The module re-reads the rows on every mount, so a change made here is
 * live the next time MindMerge is opened.
 */
function WatchControls() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [path, setPath] = useState<string>("");
  useEffect(() => {
    void Promise.all([
      window.api.settings.get("mindmerge.watch_enabled"),
      window.api.settings.get("mindmerge.watch_roots"),
      window.api.settings.get("mindmerge.watch_path"),
    ]).then(([we, roots, wp]) => {
      // Absent row = ON: the v3 ruling made watching automatic by default.
      setEnabled(we === null ? true : we === "1");
      // Display only — never a second engine start. The roots array wins; legacy watch_path is the
      // silent migration for an install that never stacked.
      let list: string[] = [];
      try {
        const parsed: unknown = JSON.parse(roots ?? "[]");
        if (Array.isArray(parsed)) list = parsed.filter((x): x is string => typeof x === "string");
      } catch {
        // corrupt row reads as absent
      }
      if (!list.length && wp) list = [wp];
      setPath(list.join("\n"));
    });
  }, []);
  const toggle = (): void => {
    if (enabled === null) return;
    const next = !enabled;
    setEnabled(next);
    void window.api.settings.set("mindmerge.watch_enabled", next ? "1" : "0");
    // ON = catch up on anything that changed while unwatched, same as the old strip toggle did.
    if (next) void window.api.mindmerge.rescan().catch(() => {});
  };
  const addFolder = async (): Promise<void> => {
    // Stacks a new import root (BL-58) — main-side dialog, persist, engine restart with ingest.
    const dir = await window.api.mindmerge.addRoot();
    if (dir) setPath((prev) => (prev ? prev + "\n" + dir : dir));
  };
  return (
    <>
      <div className="field" style={{ marginTop: 26 }}>
        <div className="setrow">
          <label htmlFor="mmwatch">Watch my folders for changes</label>
          <button
            id="mmwatch"
            role="switch"
            aria-checked={enabled === true}
            className={"switch" + (enabled ? " on" : "")}
            onClick={toggle}
          />
        </div>
        <p className="hint">
          MindMerge keeps its Documents list current on its own. Turning this off stops the folder
          watcher; nothing already ingested is touched.
        </p>
      </div>
      <div className="field">
        <div className="setrow">
          <label>Imported folders</label>
          <button className="btn" onClick={() => void addFolder()}>Add folder&hellip;</button>
        </div>
        <p className="hint" style={{ whiteSpace: "pre-line" }}>{path || "Nothing imported yet."}</p>
      </div>
    </>
  );
}

// Session cache — a repeat visit paints the real state on frame one instead of flashing "…", the
// same warm-cache pattern TimeTrackerSettings and the Settings toggles use.
let featureCache: LicenseFeatureState | null = null;

export default function MindMergeSettings() {
  const [lic, setLic] = useState<LicenseFeatureState | null>(() => featureCache);

  useEffect(() => {
    void window.api.licensing
      .features()
      .then((st) => {
        featureCache = st;
        setLic(st);
      })
      .catch(() => {});
  }, []);

  const entitled = lic?.features.mindmergeDocs ?? false;

  return (
    <>
      <h2>MindMerge</h2>

      <div className="field">
        <label>Documents</label>
        <p className="hint">
          {lic === null ? (
            "Checking your licence…"
          ) : entitled ? (
            <>
              Included in the <b>{lic.tierLabel}</b> tier — the Documents tab is available in MindMerge.
            </>
          ) : (
            <>
              Not included in the <b>{lic.tierLabel}</b> tier. The Documents tab is hidden and MindMerge
              refuses to read or write authored documents. Enter a Pro or Business licence key under
              Settings → TimeTracker → Licence to turn it on — nothing already stored is touched, and the
              Brain tab keeps working either way.
            </>
          )}
        </p>
      </div>

      <WatchControls />
    </>
  );
}
