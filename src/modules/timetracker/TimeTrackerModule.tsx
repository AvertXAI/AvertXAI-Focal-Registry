/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker — Tracker tab (Phase 3): nested Projects rail (option 1 of
// MOCKUP-timetracker-projects-rail-6-options-07-31-2026.html), timer bar, project detail, and the
// new/edit modal. Every read/write goes through window.api.timetracker.* (Phase 2 channels — none
// added); the live clock rides the timetracker:tick push and timetracker:changed invalidates.
// Logbook / Adjust / Analytics tabs are Phase 4-5 — rendered dimmed, not wired.
import { useCallback, useEffect, useState } from "react";
import type {
  TimeTrackerGrandTotals,
  TimeTrackerGroup,
  TimeTrackerLicenseState,
  TimeTrackerGroupTotalRow,
  TimeTrackerMultiTimerStatus,
  TimeTrackerProjectListItem,
  TimeTrackerSidebarSortDir,
  TimeTrackerTickPayload,
} from "../../shared/types";
import ProjectsRail from "./ProjectsRail";
import TimerBar from "./TimerBar";
import ProjectDetail from "./ProjectDetail";
import ProjectModal, { type ModalState } from "./ProjectModal";
import LogbookView from "./LogbookView";
import AdjustmentsView from "./AdjustmentsView";
import ActivityView from "./ActivityView";
import ArchiveView from "./ArchiveView";
import AnalyticsView from "./AnalyticsView";
import { appendQuickNote, parseSessionNotes } from "../../shared/ttNotes";
import "./timetracker.css";

type Tab = "tracker" | "logbook" | "analytics" | "adjust" | "activity" | "archive";

// Module-level caches — instant re-entry paint (the migrate/mindmerge pattern); a running timer's
// truth lives main-side, so a stale cache can never fake a clock. Never localStorage.
let projectsCache: TimeTrackerProjectListItem[] | null = null;
let selectedCache: number | null = null;
// Rail collapse — THE remount bug's fix has two layers: this cache survives module unmount/remount
// within a session (component state alone dies with the unmount — that was the days-to-find bug),
// and app_settings "timetracker.rail_collapsed" (service → IPC → preload, in RENDERER_KEYS)
// survives restart. Theme changes never unmount the module, so they are covered by both.
let railCollapsedCache: boolean | null = null;

/** Rail-style compact hours: 36h · 3.5h · 0h. */
export const fmtHours = (seconds: number): string => {
  const h = seconds / 3600;
  if (h === 0) return "0h";
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10}h`;
};

export default function TimeTrackerModule() {
  const api = window.api;
  const [projects, setProjects] = useState<TimeTrackerProjectListItem[]>(() => projectsCache ?? []);
  const [groups, setGroups] = useState<TimeTrackerGroup[]>([]);
  const [totals, setTotals] = useState<TimeTrackerGroupTotalRow[]>([]);
  const [sortDir, setSortDir] = useState<TimeTrackerSidebarSortDir>("none");
  const [status, setStatus] = useState<TimeTrackerMultiTimerStatus>({ sessions: [], focusedId: null });
  // False until the first status read settles. The empty initial value above is indistinguishable
  // from "no timers running", which is exactly how a cold reload made live notes look erased.
  const [statusReady, setStatusReady] = useState(false);
  const [tick, setTick] = useState<TimeTrackerTickPayload | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(() => selectedCache);
  const [modal, setModal] = useState<ModalState>(null);
  const [tab, setTab] = useState<Tab>("tracker");
  const [grand, setGrand] = useState<TimeTrackerGrandTotals | null>(null);
  // Transient "N quick notes filed" banner (mockup v3, state 2). Cleared on a timeout by the detail
  // panel's own effect — it is presentation, so nothing about it is persisted.
  const [filed, setFiled] = useState<{ count: number; at: string } | null>(null);
  // STABLE identity. As an inline arrow this was recreated on every render, and the detail panel's
  // dismiss timer lists it as a dependency — so every render (every tab switch, every state change)
  // tore the timer down and started a fresh one. The banner only cleared after a full quiet period
  // rather than a fixed 3 seconds (Jason 08-02-2026).
  const clearFiled = useCallback(() => setFiled(null), []);
  // Bumped on every reload — the detail panel re-fetches its one-round-trip projectDetail on it.
  const [refreshKey, setRefreshKey] = useState(0);
  const [railCollapsed, setRailCollapsed] = useState<boolean>(() => railCollapsedCache ?? false);
  const [license, setLicense] = useState<TimeTrackerLicenseState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [miniOpen, setMiniOpen] = useState(false);

  useEffect(() => {
    void api.timetracker.mini.state().then((s) => setMiniOpen(s.open)).catch(() => {});
  }, [api]);
  const toggleMini = (): void => {
    void api.timetracker.mini.toggle().then((s) => setMiniOpen(s.open)).catch(() => {});
  };

  // Warm the collapse state from app_settings on every mount (a renderer reload wipes the cache);
  // the cache-seeded initial state means a same-session remount paints correctly on frame one.
  useEffect(() => {
    void api.settings.get("timetracker.rail_collapsed").then((v) => {
      if (v !== null) {
        railCollapsedCache = v === "1";
        setRailCollapsed(v === "1");
      }
    }).catch(() => {});
  }, [api]);
  const toggleRail = (): void => {
    setRailCollapsed((prev) => {
      const next = !prev;
      railCollapsedCache = next;
      void api.settings.set("timetracker.rail_collapsed", next ? "1" : "0").catch(() => {});
      return next;
    });
  };

  const select = (id: number | null): void => {
    selectedCache = id;
    setSelectedId(id);
  };

  // One reload for everything the rail + detail render from. Called at mount and on every
  // timetracker:changed push (timer mutations move totals, so projects reload too).
  const reload = useCallback((): void => {
    void api.timetracker.projects.list().then((p) => {
      projectsCache = p;
      setProjects(p);
    }).catch(() => {});
    void api.timetracker.groups.list().then(setGroups).catch(() => {});
    void api.timetracker.projects.groupTotals().then(setTotals).catch(() => {});
    void api.timetracker.sidebar.getSort().then(setSortDir).catch(() => {});
    // SCOPED failure path (the wider swallowed-catch pattern is a reported finding, not refactored
    // here): this read carries the running session AND its captured quick notes, so a silent failure
    // renders the Session notes block empty over notes that exist. Ready is set either way, so the
    // panel resolves to a real state instead of saying "Loading…" forever.
    void api.timetracker.timer
      .status()
      .then((s) => {
        setStatus(s);
        setStatusReady(true);
      })
      .catch((e: unknown) => {
        console.error("[timetracker] timer status failed:", e);
        setStatusReady(true);
      });
    void api.timetracker.projects.grandTotals().then(setGrand).catch(() => {});
    void api.timetracker.license.get().then(setLicense).catch(() => {});
    setRefreshKey((k) => k + 1);
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Live pushes: tick drives the clock (fires only while sessions exist); changed invalidates.
  useEffect(() => {
    const onTick = (p: TimeTrackerTickPayload): void => setTick(p);
    const onChanged = (): void => reload();
    api.on<TimeTrackerTickPayload>("timetracker:tick", onTick);
    api.on<void>("timetracker:changed", onChanged);
    return () => {
      api.off<TimeTrackerTickPayload>("timetracker:tick", onTick);
      api.off<void>("timetracker:changed", onChanged);
    };
  }, [api, reload]);

  // Selection heals when the selected project vanishes (deleted elsewhere / first load).
  useEffect(() => {
    if (projects.length === 0) return;
    if (selectedId === null || !projects.some((p) => p.id === selectedId)) select(projects[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const session = selected ? status.sessions.find((s) => s.projectId === selected.id) ?? null : null;
  const tickSession = session ? tick?.sessions.find((t) => t.id === session.id) ?? null : null;

  // ---- rail callbacks (drag semantics: same group → reorder before target; cross-group → regroup) ----
  const onReorder = (dragId: number, targetId: number): void => {
    const drag = projects.find((p) => p.id === dragId);
    const target = projects.find((p) => p.id === targetId);
    if (!drag || !target || dragId === targetId) return;
    const op =
      (drag.group_id ?? null) === (target.group_id ?? null)
        ? api.timetracker.projects.reorder(dragId, targetId)
        : api.timetracker.projects.setGroup(dragId, target.group_id ?? null);
    void op.then(reload).catch(() => {});
  };
  const onRegroup = (dragId: number, groupId: number | null): void => {
    void api.timetracker.projects.setGroup(dragId, groupId).then(reload).catch(() => {});
  };
  const onSort = (dir: "asc" | "desc"): void => {
    void api.timetracker.sidebar.sort(dir).then(reload).catch(() => {});
  };

  // ---- timer (bar is a dumb view; mutations land here) ----
  // No start note any more: the note field is the live-only quick-note capture (rulings 3 + 4), so
  // there is nothing to carry into start().
  const onStart = (): void => {
    if (!selected) return;
    void api.timetracker.timer
      .start(selected.id, null)
      .then((st) => {
        setStatus(st);
        // MUST reload, exactly as onStop does: starting a session CLEARS the pad main-side, and the
        // detail panel only re-reads when refreshKey bumps. Without this the renderer keeps painting
        // the pre-start detail.note — the database is empty while the screen still shows the old
        // text (Jason 08-02-2026). Never leave a surface rendering state this action just invalidated.
        reload();
      })
      .catch(() => {});
  };
  // ONE captured quick note → appended to the session's packed column through the new channel. The
  // append is composed here from main-side truth (session.note) using the shared format module, so
  // the renderer never invents a marker the main process wouldn't recognise.
  const onQuickNote = (text: string): void => {
    if (!session) return;
    const packed = appendQuickNote(session.note, text, new Date().toISOString());
    void api.timetracker.timer.setSessionNote(session.id, packed).then(setStatus).catch(() => {});
  };
  // The Session notes EDITOR's blur save — the second of the two editors (ruling 1). It hands over
  // an already-packed value, so the same channel serves both writers.
  const onSessionNotes = (packed: string | null): void => {
    if (!session) return;
    void api.timetracker.timer.setSessionNote(session.id, packed).then(setStatus).catch(() => {});
  };
  const onPause = (): void => {
    if (!session) return;
    void api.timetracker.timer.pause(session.id).then(setStatus).catch(() => {});
  };
  const onResume = (): void => {
    if (!session) return;
    void api.timetracker.timer.resume(session.id).then(setStatus).catch(() => {});
  };
  // Stop files the quick notes MAIN-SIDE (see the stopTimer handler). The count and the header time
  // are computed HERE from the session we are about to stop — the channel's return shape is left
  // untouched because the mini timer's stop rides the same channel.
  const onStop = (): void => {
    if (!session) return;
    const { lines } = parseSessionNotes(session.note);
    const filedAt = session.wallStartedAt;
    void api.timetracker.timer
      .stop(session.id, null)
      .then((st) => {
        setStatus(st);
        if (lines.length > 0) setFiled({ count: lines.length, at: filedAt });
        reload(); // the pad's new block only exists main-side until the detail refetches
      })
      .catch(() => {});
  };

  const onColor = (color: string): void => {
    if (!selected) return;
    void api.timetracker.projects.setColor(selected.id, color).then(reload).catch(() => {});
  };

  // FIX 5 (post-6A): the cap fires on the "+ New project" CLICK — at cap the modal never opens and a
  // toast names the resolved-tier number (never a literal). This is an EARLY HINT ONLY: the real
  // limit stays main-side (projects.ts createProject → enforceCap), unchanged and unbypassed.
  const guardedNewProject = (): void => {
    const cap = license?.caps.projects ?? null;
    if (cap !== null && projects.length >= cap) {
      setToast(`Project cap limited (${cap}), upgrade to add more projects`);
      return;
    }
    setModal({ mode: "new" });
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Archive from the detail panel (reason required — the detail's own modal collects it). The
  // project leaves the active list; the selection-heal effect picks the next one.
  const onArchive = (reason: string): void => {
    if (!selected) return;
    void api.timetracker.projects.archive(selected.id, reason).then(reload).catch(() => {});
  };

  return (
    <main className="view shown tt-shell">
      <ProjectsRail
        projects={projects}
        groups={groups}
        totals={totals}
        sortDir={sortDir}
        selectedId={selectedId}
        onSelect={select}
        onNew={guardedNewProject}
        onSort={onSort}
        onReorder={onReorder}
        onRegroup={onRegroup}
        onOpenArchive={() => setTab("archive")}
        collapsed={railCollapsed}
        onToggleCollapse={toggleRail}
      />
      <div className="tt-main">
        {/* Tab strip per the approved mockup — Analytics went live in Phase 5. */}
        <div className="tt-tabs">
          {([
            ["tracker", "Tracker"],
            ["logbook", "Logbook"],
            ["analytics", "Analytics"],
            ["adjust", "Adjustments"],
            ["activity", "Activity"],
            ["archive", "Archive"],
          ] as const).map(([key, label]) => (
            <button key={key} className={"tt-tab" + (tab === key ? " on" : "")} onClick={() => setTab(key)}>{label}</button>
          ))}
          <button
            className={"tt-minibtn" + (miniOpen ? " on" : "")}
            title={miniOpen ? "Close the floating mini timer (timers keep running)" : "Open the floating mini timer"}
            onClick={toggleMini}
          >
            Mini timer
          </button>
        </div>
        <div className="tt-tabbody">
          {tab === "tracker" && (
            <>
              <TimerBar
                projects={projects}
                project={selected}
                session={session}
                tickSession={tickSession}
                onSelectProject={select}
                onStart={onStart}
                onQuickNote={onQuickNote}
                onPause={onPause}
                onResume={onResume}
                onStop={onStop}
              />
              <ProjectDetail
                project={selected}
                refreshKey={refreshKey}
                onEdit={() => selected && setModal({ mode: "edit", project: selected })}
                onColor={onColor}
                onNew={guardedNewProject}
                onArchive={onArchive}
                archiveBlocked={session !== null}
                onDataChanged={reload}
                session={session}
                onSessionNotes={onSessionNotes}
                filed={filed}
                onFiledSeen={clearFiled}
                statusReady={statusReady}
              />
            </>
          )}
          {tab === "logbook" && <LogbookView projects={projects} groups={groups} />}
          {tab === "analytics" && <AnalyticsView />}
          {tab === "adjust" && <AdjustmentsView projects={projects} onDataChanged={reload} />}
          {tab === "activity" && <ActivityView projects={projects} />}
          {tab === "archive" && <ArchiveView onDataChanged={reload} />}
        </div>
        {/* GRAND TOTAL — all-time, ALL projects (not the selection). Pinned above the shell footer. */}
        {grand && (
          <div className="tt-grandbar">
            <span className="tt-grandlabel">Grand total</span>
            <span className="tt-grandvals">
              {`${Math.floor(grand.total_seconds / 3600)}h ${String(Math.floor((grand.total_seconds % 3600) / 60)).padStart(2, "0")}m`}
              {" · "}
              {grand.total_value.toLocaleString(undefined, { style: "currency", currency: "USD" })}
              {" · "}
              {grand.total_costs.toLocaleString(undefined, { style: "currency", currency: "USD" })} costs
              {" · "}
              {(grand.total_value + grand.total_costs).toLocaleString(undefined, { style: "currency", currency: "USD" })} total invested
            </span>
            <span className="tt-grandcount">across {grand.project_count} project{grand.project_count === 1 ? "" : "s"}</span>
          </div>
        )}
      </div>
      {toast && <div className="tt-toast" role="status">{toast}</div>}
      {modal && (
        <ProjectModal
          state={modal}
          groups={groups}
          onClose={() => setModal(null)}
          onSaved={(p) => {
            setModal(null);
            select(p.id);
            reload();
          }}
        />
      )}
    </main>
  );
}
