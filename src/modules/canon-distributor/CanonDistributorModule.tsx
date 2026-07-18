/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Distributor — approved spine layout. Header (Canon / Guardrails / Push all) + summary bar
// (status pills, filter, sort) + the SPINE (source-of-truth node, trunk, one branch row per
// target) + full-width activity log. Source/add-target/sync/watcher controls are RE-HOMED into
// the Canon modal (same handlers as before — logic unchanged). The Guardrails modal only SELECTS
// a template + favorite agents per target and persists the manifest; NOTHING here stamps files
// to disk (later bite). All data through window.api.dist/templates/agents.
import { useEffect, useMemo, useState } from "react";
import type { CanonAgent, CanonTemplate, DistLogRow, DistTarget, SyncResult, TargetSyncStatus } from "../../shared/types";
import { bumpRender } from "../../diag";
import ActivityLogView from "./ActivityLogView";
import TemplatesView from "./TemplatesView";
import AgentsView from "./AgentsView";
import HistoryView from "./HistoryView";

type Statuses = Record<string, TargetSyncStatus>;
type SortKey = "name" | "status" | "path";

const ACTION_CLS: Record<string, string> = { COPY: "ok", REPLACE: "rp", ERROR: "er", NUKE: "nk", SYNC: "ok", PRUNE: "t", AGENT: "rp" };

// Last-known state per target derived from dist_log (newest-first rows): the newest row mentioning
// the target's path decides — ERROR → pending(gold), ship actions → synced(green), none → pending.
function statusFromHistory(history: DistLogRow[], t: DistTarget): "synced" | "pending" {
  for (const r of history) {
    if (!r.detail.includes(t.path)) continue;
    return r.action === "ERROR" ? "pending" : "synced";
  }
  return "pending";
}

// Distinct canon .md files ever shipped to this target (COPY/REPLACE rows carry "file.md -> path").
function canonCount(history: DistLogRow[], t: DistTarget): number {
  const names = new Set<string>();
  for (const r of history) {
    if ((r.action === "COPY" || r.action === "REPLACE") && r.detail.includes(t.path)) {
      names.add(r.detail.split(" -> ")[0]);
    }
  }
  return names.size;
}

function agentCount(t: DistTarget): number {
  try {
    const arr = JSON.parse(t.selected_agent_ids ?? "[]") as unknown;
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

// Source file count from the latest SYNC summary row: "shipped: … (N files)".
function shipmentCount(history: DistLogRow[]): number | null {
  for (const r of history) {
    if (r.action !== "SYNC") continue;
    const m = /\((\d+) files\)/.exec(r.detail);
    return m ? Number(m[1]) : null;
  }
  return null;
}

export default function CanonDistributorModule() {
  bumpRender("Distributor"); // DIAG-2
  const [showLog, setShowLog] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [source, setSource] = useState<string | null>(null);
  const [srcInput, setSrcInput] = useState("");
  const [watcher, setWatcher] = useState(false);
  const [targets, setTargets] = useState<DistTarget[]>([]);
  const [statuses, setStatuses] = useState<Statuses>({}); // uuid -> live outcome from dist:synced
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newPath, setNewPath] = useState("");
  const [recent, setRecent] = useState<DistLogRow[]>([]);
  const [history, setHistory] = useState<DistLogRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // spine controls
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [spineOpen, setSpineOpen] = useState(true);

  // modals
  const [canonOpen, setCanonOpen] = useState(false);
  const [guardFor, setGuardFor] = useState<string | null>(null); // target uuid
  const [templates, setTemplates] = useState<CanonTemplate[]>([]);
  const [agents, setAgents] = useState<CanonAgent[]>([]);
  const [selTemplate, setSelTemplate] = useState<number | null>(null);
  const [selAgents, setSelAgents] = useState<Set<number>>(new Set());
  const [note, setNote] = useState<string | null>(null);

  const refreshTargets = () => void window.api.dist.listTargets().then(setTargets);
  const refreshRecent = () => void window.api.dist.listLog(10).then(setRecent);
  const refreshHistory = () => void window.api.dist.history().then(setHistory);

  useEffect(() => {
    void window.api.dist.getSource().then((s) => setSource(s?.path ?? null));
    void window.api.dist.getWatcher().then(setWatcher);
    refreshTargets();
    refreshRecent();
    refreshHistory();
    const onSynced = (r: SyncResult) => {
      setLastSync(r);
      setStatuses((prev) => {
        const next = { ...prev };
        for (const t of r.targets) next[t.uuid] = t;
        return next;
      });
      refreshRecent();
      refreshHistory();
    };
    window.api.on("dist:synced", onSynced);
    return () => window.api.off("dist:synced", onSynced);
  }, []);

  // The native min/□/✕ overlay is OS-drawn above the DOM — dim it while a modal is open.
  const modalOpen = canonOpen || guardFor !== null;
  useEffect(() => {
    void window.api.theme.setModalDim(modalOpen);
    return () => void window.api.theme.setModalDim(false);
  }, [modalOpen]);

  const run = (p: Promise<unknown>, after?: () => void) => {
    setErr(null);
    p.then(after).catch((e: unknown) => setErr(String(e)));
  };

  // --- existing handlers, re-homed unchanged (Canon modal) ---
  const browseSource = () =>
    run(
      window.api.dist.pickFolder().then(async (p) => {
        if (!p) return;
        await window.api.dist.setSource(p);
        setSource(p);
      })
    );
  const setSourceManual = () =>
    run(window.api.dist.setSource(srcInput.trim()), () => {
      setSource(srcInput.trim());
      setSrcInput("");
    });
  const toggleWatcher = () => run(window.api.dist.setWatcher(!watcher).then(setWatcher));
  const push = () => run(window.api.dist.syncNow()); // result also arrives via dist:synced
  const browseTarget = () =>
    run(
      window.api.dist.pickFolder().then((p) => {
        if (p) setNewPath(p);
      })
    );
  const addTarget = () =>
    run(window.api.dist.addTarget(newLabel.trim(), newPath.trim()), () => {
      setNewLabel("");
      setNewPath("");
      refreshTargets();
    });
  const toggleTarget = (t: DistTarget) =>
    run(window.api.dist.setTargetEnabled(t.uuid, t.is_enabled !== 1), refreshTargets);
  const removeTarget = (t: DistTarget) => {
    if (!window.confirm(`Remove target "${t.label}"? Files already copied are left in place.`)) return;
    run(window.api.dist.removeTarget(t.uuid), refreshTargets);
  };

  // --- per-target status: live dist:synced result wins, else derived from dist_log ---
  const targetStatus = (t: DistTarget): "synced" | "pending" => {
    const live = statuses[t.uuid];
    if (live) return live.status === "synced" ? "synced" : "pending";
    return statusFromHistory(history, t);
  };

  const spine = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = targets
      .map((t) => ({ t, status: targetStatus(t) }))
      .filter(({ t, status }) => !q || t.label.toLowerCase().includes(q) || t.path.toLowerCase().includes(q) || status.includes(q));
    rows.sort((a, b) =>
      sortKey === "name"
        ? a.t.label.localeCompare(b.t.label)
        : sortKey === "path"
          ? a.t.path.localeCompare(b.t.path)
          : a.status.localeCompare(b.status) || a.t.label.localeCompare(b.t.label)
    );
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, filter, sortKey, statuses, history]);

  const syncedCount = targets.filter((t) => targetStatus(t) === "synced").length;

  // --- Guardrails modal ---
  const openGuardrails = (uuid: string) => {
    setNote(null);
    setErr(null);
    void window.api.templates.list().then(setTemplates);
    void window.api.agents.list().then(setAgents);
    const t = targets.find((x) => x.uuid === uuid);
    setSelTemplate(t?.template_id ?? null);
    try {
      const ids = JSON.parse(t?.selected_agent_ids ?? "[]") as number[];
      setSelAgents(new Set(Array.isArray(ids) ? ids : []));
    } catch {
      setSelAgents(new Set());
    }
    setGuardFor(uuid);
  };
  const saveGuardrails = () => {
    if (!guardFor) return;
    run(window.api.dist.setManifest(guardFor, selTemplate, [...selAgents]), () => {
      refreshTargets();
      setGuardFor(null);
    });
  };
  const favAgents = agents.filter((a) => a.is_favorite === 1);
  const guardTarget = targets.find((t) => t.uuid === guardFor);

  // Internal view swaps (ONE sidebar entry) — all hooks above run first, then conditionally render.
  if (showLog) return <ActivityLogView onBack={() => setShowLog(false)} />;
  if (showTemplates) return <TemplatesView onBack={() => setShowTemplates(false)} />;
  if (showAgents) return <AgentsView onBack={() => setShowAgents(false)} />;
  if (showHistory) return <HistoryView onBack={() => setShowHistory(false)} />;

  return (
    <main className="view shown">
      <div className="wrap">
        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 className="pagetitle">Distributor</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => setCanonOpen(true)} title="Canon — source, targets, sync">
              ⛃ Canon
            </button>
            <button
              className="btn"
              onClick={() => targets[0] && openGuardrails(targets[0].uuid)}
              disabled={targets.length === 0}
              title="Guardrails — template + agents per target"
            >
              🛡 Guardrails
            </button>
            <button className="btn primary" onClick={push} disabled={source === null} title="Push canon to all enabled targets">
              ⤓ Push all
            </button>
          </div>
        </div>
        <p className="subtitle">
          {targets.length} target{targets.length === 1 ? "" : "s"} · Watcher {watcher ? "ON" : "OFF"}
          {lastSync && ` · last run: ${lastSync.ok} synced, ${lastSync.errors} errors`}
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button className="btn ghost" onClick={() => setShowAgents(true)}>▢ Agents</button>
          <button className="btn ghost" onClick={() => setShowTemplates(true)}>▢ Templates</button>
          <button className="btn ghost" onClick={() => setShowHistory(true)}>▤ History</button>
          <button className="btn ghost" onClick={() => setShowLog(true)}>▤ Activity log</button>
        </div>

        {err !== null && (
          <p className="hint" style={{ color: "var(--canon-distributor-error)", marginBottom: 12 }}>{err}</p>
        )}

        {/* SUMMARY BAR */}
        <div className="cd-summary">
          <span className="badge b-ok">{syncedCount} synced</span>
          <span className="badge b-pend">{targets.length - syncedCount} pending</span>
          <span className="badge b-pend">{targets.length} total</span>
          <input
            className="input"
            style={{ flex: 1, maxWidth: "none" }}
            placeholder="Filter targets by name, path, or status…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select className="input" style={{ width: "auto" }} value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} title="Sort">
            <option value="name">Sort: name</option>
            <option value="status">Sort: status</option>
            <option value="path">Sort: path</option>
          </select>
        </div>

        {/* SPINE */}
        <div className="modcard" style={{ marginBottom: 14 }}>
          <div className="cd-src">
            <button
              className="cd-iconbtn"
              onClick={() => setSpineOpen((o) => !o)}
              title={spineOpen ? "Collapse targets" : "Expand targets"}
              aria-expanded={spineOpen}
            >
              {spineOpen ? "▾" : "▸"}
            </button>
            <span className="cd-dot ok" style={{ background: source ? "var(--mc-green)" : "var(--canon-distributor-pending)" }} />
            <span className="name">Source of truth</span>
            <span className="cd-path">{source ?? "not configured — open ⛃ Canon"}</span>
            {shipmentCount(history) !== null && <span className="cd-chip">canon {shipmentCount(history)}</span>}
            <span className="cd-chip">watcher {watcher ? "ON" : "OFF"}</span>
          </div>
          {spineOpen && (
            <div className="cd-trunk">
              {spine.map(({ t, status }) => (
                <div className="cd-branch" key={t.uuid}>
                  <span className={`cd-dot ${status === "synced" ? "ok" : "pend"}`} />
                  <span className="cd-name" style={t.is_enabled !== 1 ? { color: "var(--mc-muted)", textDecoration: "line-through" } : undefined}>
                    {t.label}
                  </span>
                  <span className="cd-path">{t.path}</span>
                  <span className="cd-chip">canon {canonCount(history, t)}</span>
                  <span className="cd-chip">{agentCount(t)} agents</span>
                  <button className="cd-iconbtn" onClick={() => setCanonOpen(true)} title="Canon">⛃</button>
                  <button className="cd-iconbtn" onClick={() => openGuardrails(t.uuid)} title="Guardrails for this target">🛡</button>
                  {/* per-target push needs engine support — later bite; .nb = house not-built marker */}
                  <button className="cd-iconbtn nb" title="Push this target (coming soon)">⤓</button>
                </div>
              ))}
              {spine.length === 0 && (
                <p className="hint" style={{ margin: "8px 0" }}>
                  {targets.length === 0 ? "No targets yet — add one in ⛃ Canon." : "No targets match the filter."}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ACTIVITY LOG — full width */}
        <div className="modcard">
          <div className="row1" style={{ justifyContent: "space-between" }}>
            <span className="name">Activity</span>
            <button className="btn ghost" onClick={() => setShowLog(true)}>
              Open full log →
            </button>
          </div>
          <div className="log">
            {recent.map((r) => (
              <div key={r.id}>
                <span className="t">{r.created_at}</span>
                <span className={ACTION_CLS[r.action] ?? "t"}>{r.action}</span>
                {r.detail}
              </div>
            ))}
            {recent.length === 0 && <div className="t">No activity yet.</div>}
          </div>
        </div>
      </div>

      {/* CANON MODAL — re-homed source / add-target / sync controls (existing handlers) */}
      {canonOpen && (
        <div className="overlay" onClick={() => setCanonOpen(false)}>
          <div className="modal" style={{ width: "min(720px, 94vw)" }} role="dialog" aria-label="Canon" onClick={(e) => e.stopPropagation()}>
            <h3>⛃ Canon</h3>

            <div className="field">
              <label>Source of truth</label>
              {source && <div className="pathline">{source}</div>}
              <div className="fieldrow">
                <button className="btn" onClick={browseSource}>Browse…</button>
                <input
                  className="input"
                  style={{ flex: 1, maxWidth: "none" }}
                  placeholder="…or paste an absolute path"
                  value={srcInput}
                  onChange={(e) => setSrcInput(e.target.value)}
                />
                <button className="btn ghost" onClick={setSourceManual} disabled={srcInput.trim().length === 0}>Set</button>
              </div>
            </div>

            <div className="field" style={{ marginTop: 8 }}>
              <div className="fieldrow" style={{ alignItems: "center" }}>
                <button className={`toggle${watcher ? " on" : ""}`} role="switch" aria-checked={watcher} onClick={toggleWatcher} disabled={source === null}>
                  <span className="knob" />
                </button>
                <span className="hint" style={{ margin: 0 }}>
                  {source === null ? "Set a source first to enable the watcher" : `Watcher ${watcher ? "ON" : "OFF"} — auto-syncs on change`}
                </span>
              </div>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label>＋ Add target</label>
              <input className="input" style={{ maxWidth: "none" }} placeholder="Title (e.g. TimeTracker)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
              <div className="fieldrow" style={{ marginTop: 6 }}>
                <input className="input" style={{ flex: 1, maxWidth: "none" }} placeholder="Absolute path to the project root" value={newPath} onChange={(e) => setNewPath(e.target.value)} />
                <button className="btn ghost" onClick={browseTarget}>Browse…</button>
                <button className="btn" onClick={addTarget} disabled={newLabel.trim().length === 0 || newPath.trim().length === 0}>Add</button>
              </div>
            </div>

            {targets.length > 0 && (
              <div className="field" style={{ marginTop: 14 }}>
                <label>write to →</label>
                {targets.map((t) => (
                  <div className="cd-branch" key={t.uuid}>
                    <button className={`toggle${t.is_enabled === 1 ? " on" : ""}`} role="switch" aria-checked={t.is_enabled === 1} onClick={() => toggleTarget(t)} style={{ transform: "scale(.8)" }}>
                      <span className="knob" />
                    </button>
                    <span className="cd-name">{t.label}</span>
                    <span className="cd-path">{t.path}\CANON\</span>
                    <button className="cd-iconbtn" onClick={() => removeTarget(t)} title="Remove target">✕</button>
                  </div>
                ))}
              </div>
            )}

            <div className="fieldrow" style={{ marginTop: 16 }}>
              <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={() => setCanonOpen(false)}>Close</button>
              <button className="btn primary" onClick={push} disabled={source === null}>Sync now</button>
            </div>
          </div>
        </div>
      )}

      {/* GUARDRAILS MODAL — selection only; the disk stamp is a later bite */}
      {guardFor !== null && (
        <div className="overlay" onClick={() => setGuardFor(null)}>
          <div className="modal" style={{ width: "min(640px, 94vw)" }} role="dialog" aria-label="Guardrails" onClick={(e) => e.stopPropagation()}>
            <h3>🛡 Guardrails</h3>
            {note !== null && <p className="hint" style={{ color: "var(--mc-green)", marginBottom: 10 }}>{note}</p>}

            <div className="field">
              <label>Apply to target</label>
              <select className="input" style={{ maxWidth: "none" }} value={guardFor} onChange={(e) => openGuardrails(e.target.value)}>
                {targets.map((t) => (
                  <option key={t.uuid} value={t.uuid}>{t.label} — {t.path}</option>
                ))}
              </select>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label>CLAUDE.md template</label>
              <select
                className="input"
                style={{ maxWidth: "none" }}
                value={selTemplate ?? ""}
                onChange={(e) => setSelTemplate(e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">(none)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.title} · {t.version}</option>
                ))}
              </select>
              {templates.length === 0 && <p className="hint" style={{ margin: "6px 0 0" }}>No templates yet — build one in ▢ Templates.</p>}
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label>Favorite agents</label>
              {favAgents.length === 0 && <p className="hint" style={{ margin: "6px 0 0" }}>No favorites yet — star agents in ▢ Agents.</p>}
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {favAgents.map((a) => (
                  <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={selAgents.has(a.id)}
                      onChange={(e) =>
                        setSelAgents((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(a.id);
                          else next.delete(a.id);
                          return next;
                        })
                      }
                    />
                    <span style={{ fontSize: 13 }}>~/{a.category ?? "(uncategorized)"}/{a.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <p className="hint" style={{ marginTop: 14 }}>
              write to → {guardTarget ? `${guardTarget.path}\\CLAUDE.md + \\.claude\\agents\\` : "…"} (stamps on next Push — coming soon)
            </p>

            <div className="fieldrow" style={{ marginTop: 12 }}>
              <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={() => setGuardFor(null)}>Close</button>
              <button className="btn primary" onClick={saveGuardrails}>Save selection</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
