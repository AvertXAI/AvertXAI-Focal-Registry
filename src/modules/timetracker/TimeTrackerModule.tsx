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
import "./timetracker.css";

type Tab = "tracker" | "logbook" | "adjust" | "activity" | "archive";

// Module-level caches — instant re-entry paint (the migrate/mindmerge pattern); a running timer's
// truth lives main-side, so a stale cache can never fake a clock. Never localStorage.
let projectsCache: TimeTrackerProjectListItem[] | null = null;
let selectedCache: number | null = null;

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
  const [tick, setTick] = useState<TimeTrackerTickPayload | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(() => selectedCache);
  const [modal, setModal] = useState<ModalState>(null);
  const [tab, setTab] = useState<Tab>("tracker");
  const [grand, setGrand] = useState<TimeTrackerGrandTotals | null>(null);
  // Bumped on every reload — the detail panel re-fetches its one-round-trip projectDetail on it.
  const [refreshKey, setRefreshKey] = useState(0);

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
    void api.timetracker.timer.status().then(setStatus).catch(() => {});
    void api.timetracker.projects.grandTotals().then(setGrand).catch(() => {});
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
  const onStart = (note: string): void => {
    if (!selected) return;
    void api.timetracker.timer.start(selected.id, note.trim() || null).then(setStatus).catch(() => {});
  };
  const onPause = (): void => {
    if (!session) return;
    void api.timetracker.timer.pause(session.id).then(setStatus).catch(() => {});
  };
  const onResume = (): void => {
    if (!session) return;
    void api.timetracker.timer.resume(session.id).then(setStatus).catch(() => {});
  };
  const onStop = (): void => {
    if (!session) return;
    void api.timetracker.timer.stop(session.id, null).then(setStatus).catch(() => {});
  };

  const onColor = (color: string): void => {
    if (!selected) return;
    void api.timetracker.projects.setColor(selected.id, color).then(reload).catch(() => {});
  };

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
        onNew={() => setModal({ mode: "new" })}
        onSort={onSort}
        onReorder={onReorder}
        onRegroup={onRegroup}
        onOpenArchive={() => setTab("archive")}
      />
      <div className="tt-main">
        {/* Tab strip per the approved mockup — Analytics stays dimmed until Phase 5. */}
        <div className="tt-tabs">
          {([
            ["tracker", "Tracker"],
            ["logbook", "Logbook"],
            ["adjust", "Adjustments"],
            ["activity", "Activity"],
            ["archive", "Archive"],
          ] as const).map(([key, label]) => (
            <button key={key} className={"tt-tab" + (tab === key ? " on" : "")} onClick={() => setTab(key)}>{label}</button>
          ))}
          <button className="tt-tab off" disabled title="Coming in a later phase">Analytics</button>
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
                onPause={onPause}
                onResume={onResume}
                onStop={onStop}
              />
              <ProjectDetail
                project={selected}
                refreshKey={refreshKey}
                onEdit={() => selected && setModal({ mode: "edit", project: selected })}
                onColor={onColor}
                onNew={() => setModal({ mode: "new" })}
                onArchive={onArchive}
                archiveBlocked={session !== null}
                onDataChanged={reload}
              />
            </>
          )}
          {tab === "logbook" && <LogbookView projects={projects} groups={groups} />}
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
