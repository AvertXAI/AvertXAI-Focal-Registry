/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Migrate — creative-asset discovery, bundling, export (Phase 1: M1–M3, mockup
// MOCKUP-migrate-module-07-25-2026.html). Every scan is its own TAB (renderer state, persisted via
// the sanctioned settings path — key migrate.tabs — NEVER localStorage). The ENGINE is single-slot:
// tabs beyond the running one queue (Queued · Running · Complete · Failed on each tab).
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MigrateClassDef, MigrateCreateJob, MigrateDrive, MigrateItemRow, MigrateJobSummary, MigrateProgress,
} from "../../shared/types";
import Tip from "../../components/Tip";
import "./migrate.css";
import { bumpRender } from "../../diag";

type TabView = "wizard" | "results" | "bundle";
interface TabState {
  id: string;
  label: string;
  view: TabView;
  classes: string[];
  exts: string[];
  customExts: string[];
  targetKind: "drive" | "folders";
  driveLetter: string | null;
  folders: string[];
  optFolderNames: boolean;
  optSubfolders: boolean;
  optHidden: boolean;
  jobId: number | null;
  jobStatus: string | null; // queued | counting | running | completed | failed | aborted | crashed
  destRoot: string | null;
  customLabel?: boolean; // user renamed the tab — the auto-label must never overwrite it
}

const newTab = (): TabState => ({
  id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
  label: "New scan",
  view: "wizard",
  classes: [], exts: [], customExts: [],
  targetKind: "drive", driveLetter: null, folders: [],
  optFolderNames: true, optSubfolders: true, optHidden: false,
  jobId: null, jobStatus: null, destRoot: null,
});

// Module-level caches — instant re-entry (the MindMerge listCache pattern); tabs ALSO persist to
// app_settings so they survive a full reload/navigation, never localStorage.
let tabsCache: TabState[] | null = null;
let registryCache: MigrateClassDef[] | null = null;

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
};
const fmtBytes = (n: number | null | undefined): string => {
  const v = n ?? 0;
  if (v >= 1073741824) return `${(v / 1073741824).toFixed(1)} GB`;
  if (v >= 1048576) return `${(v / 1048576).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
};

export default function MigrateModule() {
  bumpRender("migrate"); // DIAG-2
  const api = window.api;
  const [tabs, setTabs] = useState<TabState[]>(() => tabsCache ?? [newTab()]);
  const [activeId, setActiveId] = useState<string>(() => (tabsCache?.[0] ?? tabs[0]).id);
  const [registry, setRegistry] = useState<MigrateClassDef[]>(() => registryCache ?? []);
  const [drives, setDrives] = useState<MigrateDrive[]>([]);
  const [progress, setProgress] = useState<MigrateProgress | null>(null);
  const [addingExt, setAddingExt] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const loaded = useRef(false);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const mutateTabs = (fn: (prev: TabState[]) => TabState[]): void => {
    setTabs((prev) => {
      const next = fn(prev);
      tabsCache = next;
      // Persist WITHOUT volatile progress fields — sanctioned settings path (app_settings).
      void api.settings.set("migrate.tabs", JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  const patchTab = (id: string, patch: Partial<TabState>): void =>
    mutateTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  // Boot: registry + drives + persisted tabs (once); registry/tabs also come from module caches.
  useEffect(() => {
    void api.migrate.registry().then((r) => { registryCache = r; setRegistry(r); }).catch(() => {});
    void api.migrate.drives().then(setDrives).catch(() => {});
    if (!loaded.current && tabsCache === null) {
      loaded.current = true;
      void api.settings.get("migrate.tabs").then((raw) => {
        if (!raw) return;
        try {
          const saved = JSON.parse(raw) as TabState[];
          if (Array.isArray(saved) && saved.length > 0) {
            tabsCache = saved;
            setTabs(saved);
            setActiveId(saved[0].id);
          }
        } catch { /* corrupt state — fresh tab stands */ }
      }).catch(() => {});
    }
  }, [api]);

  // Live drive presence — the same push Scan uses; a plugged/unplugged drive refreshes the list.
  useEffect(() => {
    const onDrives = (list: MigrateDrive[]): void => setDrives(list);
    api.on<MigrateDrive[]>("scan:drives", onDrives);
    return () => api.off<MigrateDrive[]>("scan:drives", onDrives);
  }, [api]);

  // Engine progress → route to the tab that owns the jobId (tabs demultiplex on jobId).
  useEffect(() => {
    const onProgress = (p: MigrateProgress): void => {
      setProgress(p);
      if (p.kind === "discover") {
        mutateTabs((prev) => prev.map((t) => {
          if (t.jobId !== p.jobId) return t;
          const done = p.status === "completed";
          return { ...t, jobStatus: p.status, view: done ? "results" : t.view };
        }));
      }
    };
    api.on<MigrateProgress>("migrate:progress", onProgress);
    return () => api.off<MigrateProgress>("migrate:progress", onProgress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-label: the tab DESCRIBES its scan as soon as there is anything to describe — first
  // category + target ("Photos — ARCHIVE_D", "Creative assets — 2 folders"). A user rename
  // (customLabel) always wins; a started job keeps its bound label.
  const autoLabel = (t: TabState): string => {
    const cls = registry.find((c) => t.classes.includes(c.key));
    const drive = drives.find((d) => d.letter === t.driveLetter);
    const target = t.targetKind === "drive"
      ? (drive ? (drive.label || drive.letter) : "")
      : t.folders.length > 0 ? `${t.folders.length} folder${t.folders.length === 1 ? "" : "s"}` : "";
    if (!cls && !target) return "New scan";
    return [cls?.label ?? "Scan", target].filter(Boolean).join(" — ");
  };
  useEffect(() => {
    if (!active || active.customLabel || active.jobId !== null) return;
    const l = autoLabel(active);
    if (l !== active.label) patchTab(active.id, { label: l });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.classes, active?.driveLetter, active?.folders, active?.targetKind, registry, drives]);

  const commitRename = (id: string): void => {
    const v = renameText.trim();
    if (v) patchTab(id, { label: v, customLabel: true });
    setRenamingId(null);
  };

  // ---- wizard derived state ----
  const selectedClassDefs = useMemo(() => registry.filter((c) => active?.classes.includes(c.key)), [registry, active]);
  const chipDefs = useMemo(
    () => selectedClassDefs.flatMap((c) => c.extensions.map((e) => ({ ...e, classKey: c.key }))),
    [selectedClassDefs]
  );

  const toggleClass = (key: string): void => {
    if (!active) return;
    const on = active.classes.includes(key);
    const cls = registry.find((c) => c.key === key);
    const classExts = (cls?.extensions ?? []).map((e) => e.ext);
    patchTab(active.id, {
      classes: on ? active.classes.filter((k) => k !== key) : [...active.classes, key],
      // selecting a class pre-ticks its extensions; deselecting drops them
      exts: on ? active.exts.filter((e) => !classExts.includes(e)) : [...new Set([...active.exts, ...classExts])],
    });
  };
  const toggleExt = (ext: string): void => {
    if (!active) return;
    patchTab(active.id, {
      exts: active.exts.includes(ext) ? active.exts.filter((e) => e !== ext) : [...active.exts, ext],
    });
  };
  const addCustomExt = (): void => {
    const e = addingExt.replace(/^\./, "").trim().toLowerCase();
    if (!active || e === "" || active.exts.includes(e)) { setAddingExt(""); return; }
    patchTab(active.id, {
      exts: [...active.exts, e],
      customExts: [...active.customExts, e],
      classes: active.classes.includes("custom") ? active.classes : [...active.classes, "custom"],
    });
    setAddingExt("");
  };

  const startScan = (): void => {
    if (!active) return;
    const drive = drives.find((d) => d.letter === active.driveLetter);
    const roots = active.targetKind === "drive" ? (drive ? [`${drive.letter}\\`] : []) : active.folders;
    if (roots.length === 0 || active.exts.length === 0) return;
    const label = active.customLabel ? active.label : autoLabel(active);
    const opts: MigrateCreateJob = {
      label,
      targetKind: active.targetKind,
      driveId: null, // volume identity resolves main-side from the path (scan_drives registry)
      rootPaths: roots,
      classes: active.classes,
      extensions: active.exts,
      optFolderNames: active.optFolderNames,
      optSubfolders: active.optSubfolders,
      optHidden: active.optHidden,
    };
    void api.migrate.createJob(opts).then((jobId) => {
      patchTab(active.id, { jobId, jobStatus: "queued", label });
    }).catch(() => patchTab(active.id, { jobStatus: "failed" }));
  };

  const closeTab = (id: string): void => {
    mutateTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      return next.length > 0 ? next : [newTab()];
    });
    if (activeId === id) setActiveId(tabs.find((t) => t.id !== id)?.id ?? tabs[0].id);
  };
  const addTab = (): void => {
    const t = newTab();
    mutateTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  };

  const statusPip = (t: TabState): string =>
    t.jobStatus === "completed" ? "ok" : t.jobStatus === "failed" || t.jobStatus === "crashed" ? "bad"
      : t.jobStatus === "running" || t.jobStatus === "counting" ? "run" : t.jobStatus === "queued" ? "wait" : "";

  if (!active) return null;
  const running = active.jobStatus === "running" || active.jobStatus === "counting" || active.jobStatus === "queued";

  return (
    <main className="view shown mig-shell">
      <div className="mig-tabs">
        {/* + New scan sits FIRST (Jason 2026-07-26); new tabs append and grow to its right */}
        <button className="mig-tab add" onClick={addTab}>＋ New scan</button>
        {tabs.map((t) => (
          <div key={t.id} className={"mig-tab" + (t.id === activeId ? " on" : "")} onClick={() => setActiveId(t.id)}>
            {t.jobStatus && <span className={`mig-pip ${statusPip(t)}`} />}
            {renamingId === t.id ? (
              <input className="mig-tabrename" value={renameText} autoFocus aria-label="Rename tab"
                onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(t.id); if (e.key === "Escape") setRenamingId(null); }}
                onBlur={() => commitRename(t.id)}
                onClick={(e) => e.stopPropagation()} />
            ) : (
              <span className="mig-tablabel" title="Double-click to rename"
                onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(t.id); setRenameText(t.label); }}>{t.label}</span>
            )}
            {t.jobStatus === "queued" && <span className="mig-tabstate">Queued</span>}
            <button className="mig-tabx" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>✕</button>
          </div>
        ))}
      </div>

      <div className="mig-body">
        {active.view === "wizard" && !running && (
          <div className="mig-wrap">
            {/* STEP 1 — category cards */}
            <div className="mig-step">
              <div className="mig-steph"><span className="mig-num">1</span><span className="mig-stept">What are you looking for?</span>
                <span className="mig-hint">pick a category to start — you can narrow it below</span></div>
              <div className="mig-grid">
                {registry.map((c) => {
                  const on = active.classes.includes(c.key);
                  return (
                    <div key={c.key} className={"mig-tcard" + (on ? " on" : "")} onClick={() => toggleClass(c.key)}>
                      <div className="mig-ti" aria-hidden="true">{c.icon}</div>
                      <div className="mig-tn"><span className={"mig-ck" + (on ? " on" : "")}>{on ? "✓" : ""}</span>{c.label}</div>
                      <div className="mig-td">{c.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* STEP 2 — extension chips */}
            <div className="mig-step">
              <div className="mig-steph"><span className="mig-num">2</span><span className="mig-stept">Narrow it down</span>
                <span className="mig-hint">every type is selectable — nothing is forced</span></div>
              <div className="mig-panel">
                <div className="mig-exthead">
                  <span>{selectedClassDefs.map((c) => c.label).join(" · ") || "Pick a category above"}{chipDefs.length > 0 ? ` — ${chipDefs.length + active.customExts.length} types` : ""}</span>
                  {chipDefs.length > 0 && (
                    <span className="mig-extact">
                      <button className="mig-link" onClick={() => patchTab(active.id, { exts: [...new Set([...chipDefs.map((c) => c.ext), ...active.customExts])] })}>Select all</button>
                      {" · "}
                      <button className="mig-link" onClick={() => patchTab(active.id, { exts: [...active.customExts] })}>Clear</button>
                    </span>
                  )}
                </div>
                <div className="mig-chips">
                  {chipDefs.map((c) => {
                    const on = active.exts.includes(c.ext);
                    return (
                      <button key={c.ext} className={"mig-chip" + (on ? " on" : "")} onClick={() => toggleExt(c.ext)}>
                        <span className={"mig-ck" + (on ? " on" : "")}>{on ? "✓" : ""}</span>{c.label} <span className="mig-mono">.{c.ext}</span>
                      </button>
                    );
                  })}
                  {active.customExts.map((e) => {
                    const on = active.exts.includes(e);
                    return (
                      <button key={e} className={"mig-chip" + (on ? " on" : "")} onClick={() => toggleExt(e)}>
                        <span className={"mig-ck" + (on ? " on" : "")}>{on ? "✓" : ""}</span>Custom <span className="mig-mono">.{e}</span>
                      </button>
                    );
                  })}
                  <span className="mig-chip addc">
                    ＋ <input className="mig-extinput" placeholder="Add extension" value={addingExt}
                      onChange={(e) => setAddingExt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addCustomExt(); }}
                      onBlur={addCustomExt} aria-label="Add extension" />
                  </span>
                </div>
                {active.exts.includes("psp") && <Tip id="TIP-MIG-001" />}
              </div>
            </div>

            {/* STEP 3 — where to look */}
            <div className="mig-step">
              <div className="mig-steph"><span className="mig-num">3</span><span className="mig-stept">Where should we look?</span>
                <span className="mig-hint">a whole drive, or just the folders you choose</span></div>
              <div className="mig-rowsplit">
                <div className="mig-panel">
                  <div className="mig-exthead"><span>Whole drive</span></div>
                  {drives.map((d) => {
                    const on = active.targetKind === "drive" && active.driveLetter === d.letter;
                    return (
                      <div key={d.letter} className={"mig-drive" + (on ? " on" : "")}
                        onClick={() => patchTab(active.id, { targetKind: "drive", driveLetter: d.letter })}>
                        <span className="mig-di" aria-hidden="true">{d.removable ? "🔌" : "💽"}</span>
                        <div>
                          <div className="mig-dn">{d.label || "Local Disk"} ({d.letter})
                            {d.removable && <span className="mig-remov">Removable</span>}</div>
                          <div className="mig-ds">{d.filesystem} · serial {d.serial} · {fmtBytes(d.freeBytes)} free</div>
                        </div>
                        <span className="mig-dr">{fmtBytes(d.totalBytes)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mig-panel">
                  <div className="mig-exthead"><span>Specific folders</span>
                    <span className="mig-extact"><button className="mig-link" onClick={() => {
                      void api.migrate.pickFolders().then((paths) => {
                        if (paths.length > 0) patchTab(active.id, { targetKind: "folders", folders: [...new Set([...active.folders, ...paths])] });
                      });
                    }}>＋ Add folder</button></span>
                  </div>
                  {active.folders.map((f) => (
                    <div key={f} className={"mig-drive" + (active.targetKind === "folders" ? " on" : "")}
                      onClick={() => patchTab(active.id, { targetKind: "folders" })}>
                      <span className="mig-di" aria-hidden="true">🗀</span>
                      <div><div className="mig-dn mig-mono">{f}</div><div className="mig-ds">including subfolders</div></div>
                      <button className="mig-tabx" aria-label="Remove folder"
                        onClick={(e) => { e.stopPropagation(); patchTab(active.id, { folders: active.folders.filter((x) => x !== f) }); }}>✕</button>
                    </div>
                  ))}
                  <h3 className="mig-sech">Options</h3>
                  {([
                    ["optFolderNames", "Search folder names as well as file names"],
                    ["optSubfolders", "Follow subfolders"],
                    ["optHidden", "Include hidden and system folders"],
                  ] as const).map(([k, label]) => (
                    <div key={k} className="mig-opt" onClick={() => patchTab(active.id, { [k]: !active[k] } as Partial<TabState>)}>
                      <span className={"mig-sw" + (active[k] ? " on" : "")}><i /></span> {label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {active.view === "wizard" && running && (
          <div className="mig-loadwrap">
            <span className="mig-spin big" />
            <div className="mig-loadtitle">
              {active.jobStatus === "queued" ? "Queued — another scan is running" :
                active.jobStatus === "counting" ? "Counting folders…" : "Scanning…"}
            </div>
            <div className="mig-loadsub mig-mono">
              {progress && progress.jobId === active.jobId
                ? progress.foldersTotal
                  ? `${progress.foldersWalked.toLocaleString()} of ${progress.foldersTotal.toLocaleString()} folders · ${progress.filesFound.toLocaleString()} found`
                  : `${progress.foldersWalked.toLocaleString()} folders · ${progress.filesFound.toLocaleString()} found`
                : "Starting…"}
            </div>
            {active.jobId !== null && active.jobStatus !== "queued" && (
              <button className="mig-btn" onClick={() => void api.migrate.abortJob(active.jobId!)}>Stop</button>
            )}
          </div>
        )}

        {(active.jobStatus === "failed" || active.jobStatus === "crashed" || active.jobStatus === "aborted") && active.view === "wizard" && (
          <div className="mig-loadwrap">
            <div className="mig-loadtitle">Scan {active.jobStatus}.</div>
            <button className="mig-btn" onClick={() => patchTab(active.id, { jobId: null, jobStatus: null })}>Edit and retry</button>
          </div>
        )}

        {active.view === "results" && active.jobId !== null && (
          <ResultsView key={active.jobId} jobId={active.jobId} onBundle={() => patchTab(active.id, { view: "bundle" })} registry={registry} />
        )}
        {active.view === "bundle" && active.jobId !== null && (
          <BundleView jobId={active.jobId} drives={drives} progress={progress} onBack={() => patchTab(active.id, { view: "results" })} />
        )}
      </div>

      {active.view === "wizard" && !running && (
        <div className="mig-actionbar">
          <span className="mig-hint">Read only — Migrate never moves, renames, or deletes anything it finds.</span>
          <button className="mig-btn pri right" disabled={active.exts.length === 0 || (active.targetKind === "drive" ? !active.driveLetter : active.folders.length === 0)} onClick={startScan}>
            Start scan
          </button>
        </div>
      )}
    </main>
  );
}

// ---- M2 — results: summary bar, group list (registry group labels), file table with ticking ----
function ResultsView({ jobId, onBundle, registry }: { jobId: number; onBundle: () => void; registry: MigrateClassDef[] }) {
  const api = window.api;
  const [summary, setSummary] = useState<MigrateJobSummary | null>(null);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [items, setItems] = useState<MigrateItemRow[] | null>(null);
  const [reload, setReload] = useState(0);

  // ext → results-group label from the registry (Plugins/Scripts/Fonts share groups per the mockup).
  const extGroup = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of registry) for (const e of c.extensions) m.set(e.ext, e.group);
    return m;
  }, [registry]);

  interface UiGroup { key: string; label: string; exts: string[]; count: number; bytes: number; selected: number; warn: boolean }
  const groups: UiGroup[] = useMemo(() => {
    if (!summary) return [];
    const byLabel = new Map<string, UiGroup>();
    for (const g of summary.groups) {
      const ext = g.extension ?? "";
      const label = extGroup.get(ext) ?? (ext ? `.${ext}` : "Other");
      const u = byLabel.get(label) ?? { key: label, label, exts: [], count: 0, bytes: 0, selected: 0, warn: label === "Settings files" };
      u.exts.push(ext);
      u.count += g.count;
      u.bytes += g.bytes;
      u.selected += g.selected;
      byLabel.set(label, u);
    }
    return [...byLabel.values()].sort((a, b) => b.count - a.count);
  }, [summary, extGroup]);

  const activeGroup = groups.find((g) => g.key === groupKey) ?? groups[0] ?? null;
  const settingsCount = groups.find((g) => g.key === "Settings files")?.count ?? 0;

  useEffect(() => {
    void api.migrate.jobSummary(jobId).then(setSummary).catch(() => {});
  }, [api, jobId, reload]);
  useEffect(() => {
    if (!activeGroup) return;
    setItems(null);
    // Groups can span several extensions (Plugins .8bf .8bi…) — fetch each and merge.
    void Promise.all(activeGroup.exts.map((e) => api.migrate.jobItems(jobId, e || null)))
      .then((lists) => setItems(lists.flat().sort((a, b) => a.filename.localeCompare(b.filename))))
      .catch(() => setItems([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, jobId, activeGroup?.key, reload]);

  const tickRow = (it: MigrateItemRow): void => {
    void api.migrate.setSelected({ jobId, ids: [it.id], selected: it.selected !== 1 }).then(() => setReload((n) => n + 1));
  };
  const tickAllGroup = (selected: boolean): void => {
    if (!activeGroup) return;
    void Promise.all(activeGroup.exts.map((e) => api.migrate.setSelected({ jobId, extension: e || null, selected })))
      .then(() => setReload((n) => n + 1));
  };

  if (!summary) return <div className="mig-loadwrap"><span className="mig-spin big" /></div>;
  return (
    <div>
      <div className="mig-sumbar">
        <div><div className="mig-sv">{summary.total.toLocaleString()}</div><div className="mig-sl">Items found</div></div>
        <div><div className="mig-sv">{fmtBytes(summary.bytes)}</div><div className="mig-sl">Total size</div></div>
        <div><div className="mig-sv g">{summary.selected.toLocaleString()}</div><div className="mig-sl">Selected</div></div>
        {settingsCount > 0 && <div><div className="mig-sv o">{settingsCount}</div><div className="mig-sl">Settings files</div></div>}
      </div>
      <div className="mig-split">
        <div className="mig-lcol">
          <h3 className="mig-sech" style={{ marginTop: 0 }}>Groups</h3>
          {groups.map((g) => (
            <button key={g.key} className={"mig-gr" + (g.key === activeGroup?.key ? " on" : "") + (g.warn ? " warn" : "")} onClick={() => setGroupKey(g.key)}>
              <span>
                <span className="mig-gn">{g.label}</span>
                <span className="mig-gx" style={{ display: "block" }}>{g.exts.map((e) => `.${e}`).join(" ")}{g.warn ? " — unsaved presets live here" : ""}</span>
              </span>
              <span className="mig-gc">{g.count.toLocaleString()}</span>
            </button>
          ))}
        </div>
        <div className="mig-rcol">
          {activeGroup?.warn && <Tip id="TIP-MIG-001" />}
          {activeGroup && (
            <h3 className="mig-sech" style={{ marginTop: 0 }}>
              {activeGroup.label} · {activeGroup.count.toLocaleString()} found · {activeGroup.selected.toLocaleString()} selected
            </h3>
          )}
          {items === null && <div className="mig-loadwrap" style={{ padding: "40px 0" }}><span className="mig-spin big" /></div>}
          {items !== null && (
            <table className="mig-table">
              <thead>
                <tr>
                  <th style={{ width: 26 }}>
                    <span className={"mig-ck mig-rowck" + ((activeGroup?.selected ?? 0) === (activeGroup?.count ?? 0) && (activeGroup?.count ?? 0) > 0 ? " on" : "")}
                      role="checkbox" aria-checked={(activeGroup?.selected ?? 0) === (activeGroup?.count ?? 0)} aria-label="Select all in group"
                      onClick={() => tickAllGroup((activeGroup?.selected ?? 0) !== (activeGroup?.count ?? 0))}>
                      {(activeGroup?.selected ?? 0) === (activeGroup?.count ?? 0) && (activeGroup?.count ?? 0) > 0 ? "✓" : ""}
                    </span>
                  </th>
                  <th>Name</th><th>Source</th><th>Size</th><th>Modified</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <span className={"mig-ck mig-rowck" + (it.selected === 1 ? " on" : "")} role="checkbox" aria-checked={it.selected === 1}
                        aria-label={`Select ${it.filename}`} onClick={() => tickRow(it)}>{it.selected === 1 ? "✓" : ""}</span>
                    </td>
                    <td>{it.filename}{it.is_shipped_default === 1 ? " (shipped)" : ""}</td>
                    <td className="dim mig-mono">{it.source_path.slice(0, it.source_path.length - it.filename.length - 1)}</td>
                    <td className="mig-mono">{fmtBytes(it.size_bytes)}</td>
                    <td className="mig-mono dim">{fmtDate(it.mtime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {items !== null && items.length === 0 && <p className="mig-hint" style={{ marginTop: 10 }}>Nothing in this group.</p>}
          <Tip id="TIP-MIG-002" />
        </div>
      </div>
      <div className="mig-actionbar" style={{ margin: "18px -28px -30px", position: "sticky", bottom: 0 }}>
        <span className="mig-hint">{summary.selected.toLocaleString()} items · {fmtBytes(summary.selectedBytes)} selected</span>
        <button className="mig-btn right" onClick={() => tickAllGroup(true)}>Select all</button>
        <button className="mig-btn pri" disabled={summary.selected === 0} onClick={onBundle}>Add to bundle</button>
      </div>
    </div>
  );
}
// ---- M3 — bundle + export: destination, what-gets-written, both preflight guards, hash-verified copy ----
function BundleView({ jobId, drives, progress, onBack }: { jobId: number; drives: MigrateDrive[]; progress: MigrateProgress | null; onBack: () => void }) {
  const api = window.api;
  const [destLetter, setDestLetter] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<{ ok: boolean; neededBytes: number; freeBytes: number | null; bundleDir: string; error?: string } | null>(null);
  const [summary, setSummary] = useState<MigrateJobSummary | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void api.migrate.jobSummary(jobId).then(setSummary).catch(() => {});
  }, [api, jobId]);

  // Preflight re-runs on every destination change — BOTH required guards (free space + inside-source)
  // answer BEFORE the Export button can start anything.
  useEffect(() => {
    if (!destLetter) { setPreflight(null); return; }
    void api.migrate.bundlePreflight(jobId, `${destLetter}\\`).then(setPreflight).catch(() => setPreflight(null));
  }, [api, jobId, destLetter]);

  const bundleP = progress && progress.kind === "bundle" && progress.jobId === jobId ? progress : null;
  const terminal = bundleP && ["completed", "partial", "failed"].includes(bundleP.status);
  const pct = bundleP && bundleP.bytesTotal ? Math.round(((bundleP.bytesDone ?? 0) / bundleP.bytesTotal) * 100) : 0;

  const exportBundle = (): void => {
    if (!destLetter || !preflight?.ok) return;
    setExporting(true);
    void api.migrate.startBundle(jobId, `${destLetter}\\`).catch(() => {});
  };

  return (
    <div className="mig-wrap">
      <h3 className="mig-sech" style={{ marginTop: 0 }}>Destination</h3>
      {drives.map((d) => (
        <div key={d.letter} className={"mig-usb" + (destLetter === d.letter ? "" : " off")} onClick={() => setDestLetter(d.letter)}>
          <span className="mig-di" aria-hidden="true">{d.removable ? "🔌" : "💽"}</span>
          <div>
            <div className="mig-dn">{d.label || "Local Disk"} ({d.letter}){d.removable && <span className="mig-remov">Removable</span>}</div>
            <div className="mig-ds">{d.filesystem} · serial {d.serial}</div>
          </div>
          <span className="mig-dr">{fmtBytes(d.freeBytes)} free</span>
        </div>
      ))}

      {preflight && !preflight.ok && <div className="mig-err">{preflight.error}</div>}

      {preflight?.ok && summary && (
        <>
          <h3 className="mig-sech">What gets written</h3>
          <table className="mig-table">
            <thead><tr><th>Path on the drive</th><th>Holds</th><th>Items</th><th>Size</th></tr></thead>
            <tbody>
              <tr><td className="mig-mono">{preflight.bundleDir}\</td><td>This bundle — plain readable folders, no archive</td>
                <td className="mig-mono">{summary.selected.toLocaleString()}</td><td className="mig-mono">{fmtBytes(summary.selectedBytes)}</td></tr>
              <tr><td className="mig-mono">…\manifest.json</td><td>What every file is, where it came from, its checksum</td>
                <td className="mig-mono">1</td><td className="mig-mono">—</td></tr>
            </tbody>
          </table>
          <p className="mig-hint" style={{ marginTop: 8 }}>
            {fmtBytes(preflight.neededBytes)} needed (selection plus margin) · {fmtBytes(preflight.freeBytes)} free — every copy is
            checksum-verified before it counts, and the originals are never touched.
          </p>
        </>
      )}

      {(exporting || bundleP) && (
        <div style={{ marginTop: 20 }}>
          <div className="mig-hint">
            {terminal
              ? bundleP!.status === "completed" ? "Bundle complete — every copy checksum-verified."
                : bundleP!.status === "partial" ? `Bundle finished with ${bundleP!.failed} failed cop${bundleP!.failed === 1 ? "y" : "ies"} — the rest are verified.`
                  : `Bundle failed${bundleP?.error ? ` — ${bundleP.error}` : ""}.`
              : bundleP ? `Copying ${bundleP.currentPath ?? "…"} — ${bundleP.copied ?? 0} of ${bundleP.totalItems ?? 0}` : "Starting…"}
          </div>
          <div className="mig-progbar"><i style={{ width: `${terminal ? 100 : pct}%` }} /></div>
          {bundleP && !terminal && (
            <div className="mig-hint mig-mono">{pct}% · {fmtBytes(bundleP.bytesDone)} / {fmtBytes(bundleP.bytesTotal)} · verified {bundleP.copied ?? 0}</div>
          )}
          {terminal && bundleP!.status !== "failed" && preflight && (
            <button className="mig-btn" style={{ marginTop: 8 }} onClick={() => void api.migrate.openFolder(preflight.bundleDir)}>Open bundle folder</button>
          )}
        </div>
      )}

      <div className="mig-actionbar" style={{ margin: "22px -28px -30px", position: "sticky", bottom: 0 }}>
        <span className="mig-hint">Originals are copied, never moved — the old machine is left exactly as it was.</span>
        <button className="mig-btn right" onClick={onBack}>Back to results</button>
        <button className="mig-btn pri" disabled={!preflight?.ok || exporting && !terminal} onClick={exportBundle}>Export bundle</button>
      </div>
    </div>
  );
}
