/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The New Employee wizard's first two steps: the project chooser, and TimeTracker's ProjectModal
// rendered directly.
//
// ---- THE PORTAL SEAM IS RETIRED (Jason ruled 2026-08-04) ----------------------------------
// 3B.2 wrapped ProjectModal because its two action buttons were hardcoded with no props seam: the
// wrapper hid .tt-modalacts, portalled a three-button row into .tt-modal, mirrored the real
// submit's disabled state with a MutationObserver, and pressed that hidden button. All of that is
// GONE. ProjectModal now renders the three buttons natively and takes an optional
// onSavedCreateEmployee callback, so there is exactly ONE mechanism owning that action row —
// which is the whole point of the ruling. What remains here is a plain render.
//
// ---- WHY THIS FILE STILL IMPORTS TIMETRACKER'S STYLESHEET ---------------------------------
// ProjectModal renders tt-* classes, and timetracker.css is imported by exactly ONE file:
// TimeTrackerModule.tsx. Today that is harmless — App.tsx imports every module statically and Vite
// emits a single stylesheet, verified in the build output. But that is an ACCIDENT of the current
// bundling: the day someone lazy-loads modules, this modal would paint unstyled and nothing would
// fail loudly. The explicit import below is a no-op now and insurance then.
import "../timetracker/timetracker.css";

import type { TimeTrackerGroup, TimeTrackerProjectListItem } from "../../shared/types";
import ProjectModal from "../timetracker/ProjectModal";

/**
 * Step 1 — the chooser. Two doors into the same wizard: create the project first, or attach the
 * new person to a project that already exists.
 */
export function ProjectChooser({
  onAddProject,
  onAssign,
  onClose,
  hasProjects,
}: {
  onAddProject: () => void;
  onAssign: () => void;
  onClose: () => void;
  hasProjects: boolean;
}) {
  return (
    <div className="emp-modalback" onClick={onClose}>
      <div className="emp-modal narrow" role="dialog" aria-label="New employee" onClick={(e) => e.stopPropagation()}>
        <div className="emp-modalhead">New employee</div>
        <p className="emp-modaldesc">
          Everyone you pay is attached to a project — that is what makes their hours billable and
          what puts their cost on a chart. Start with the project.
        </p>
        <div className="emp-choices">
          <button className="emp-btn primary" onClick={onAddProject}>＋ Add Project</button>
          <button className="emp-btn" onClick={onAssign} disabled={!hasProjects}>Assign To Project</button>
        </div>
        {!hasProjects && (
          <p className="emp-hint" style={{ marginTop: 8 }}>
            There are no projects yet, so the first one has to be created here.
          </p>
        )}
        <div className="emp-modalacts">
          <button className="emp-btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Step 2 — TimeTracker's ProjectModal, rendered as-is. Its own three buttons do the work; the
 * third one only exists because `onSavedCreateEmployee` is passed here and omitted inside
 * TimeTracker itself, which is how one component serves both callers without a mode flag.
 */
export function ProjectModalHost({
  groups,
  onClose,
  onSavedGoToEmployee,
  onSavedStop,
  onGroupsChanged,
}: {
  groups: TimeTrackerGroup[];
  onClose: () => void;
  /** "Add Project + Create Employee" — carry the new project into the person form. */
  onSavedGoToEmployee: (p: TimeTrackerProjectListItem) => void;
  /** "Add Project" alone — the project exists, the wizard ends. */
  onSavedStop: (p: TimeTrackerProjectListItem) => void;
  onGroupsChanged?: () => void;
}) {
  return (
    <ProjectModal
      state={{ mode: "new" }}
      groups={groups}
      onClose={onClose}
      onSaved={onSavedStop}
      onSavedCreateEmployee={onSavedGoToEmployee}
      onGroupsChanged={onGroupsChanged}
    />
  );
}
