/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The New Employee wizard's first two steps: the project chooser, and TimeTracker's ProjectModal
// HOSTED INSIDE EMPLOYEES with a third action grafted on.
//
// ---- WHY THIS FILE IMPORTS TIMETRACKER'S STYLESHEET ----------------------------------------
// ProjectModal renders tt-* classes, and timetracker.css is imported by exactly ONE file:
// TimeTrackerModule.tsx:28 (08-04 recon §B4). Today that is harmless — App.tsx imports every module
// statically (App.tsx:14, 25) and Vite emits a single stylesheet, so the tt-* rules are always
// present; verified in the build output (`tt-modalback` is in dist/assets/main-*.css). But that is
// an ACCIDENT of the current bundling. The day someone lazy-loads modules, this modal would paint
// unstyled and nothing would fail loudly. The explicit import below is a no-op now and insurance
// then — it is the dependency stated out loud rather than inherited.
import "../timetracker/timetracker.css";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
          <button className="emp-btn primary" onClick={onAddProject}>
            + Add Project
          </button>
          <button className="emp-btn" onClick={onAssign} disabled={!hasProjects}>
            Assign To Project
          </button>
        </div>
        {!hasProjects && (
          <p className="emp-hint" style={{ marginTop: 8 }}>
            There are no projects yet, so the first one has to be created here.
          </p>
        )}
        <div className="emp-modalacts">
          <button className="emp-btn ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Step 2 — TimeTracker's own ProjectModal, WRAPPED, not forked.
 *
 * Its two buttons are hardcoded (ProjectModal.tsx:215-220 — no actions prop, no slot, no children),
 * so a third action cannot be passed in. The wrap renders the real component and lays an extra
 * action bar beneath it: BOTH paths save through the component's own submit, which is the same
 * api.timetracker.projects.create the native modal uses (ProjectModal.tsx:80-81). Nothing about
 * project creation is reimplemented here — this file only decides WHERE the caller goes next.
 *
 * The mechanism: onSaved is a single callback on the real modal, so the wrapper records the
 * intended destination BEFORE the click reaches it, then routes on the result. A ref would be
 * fragile; a piece of state set by the button that is about to be pressed is not.
 */
export function ProjectModalHost({
  groups,
  onClose,
  onSavedGoToEmployee,
  onSavedStop,
}: {
  groups: TimeTrackerGroup[];
  onClose: () => void;
  /** "Add Project + Create Employee" — carry the new project into the person form. */
  onSavedGoToEmployee: (p: TimeTrackerProjectListItem) => void;
  /** "Add Project" alone — the project exists, the wizard ends. */
  onSavedStop: (p: TimeTrackerProjectListItem) => void;
}) {
  const [thenCreate, setThenCreate] = useState(true);
  const [seamBroken, setSeamBroken] = useState(false);
  /** The .tt-modal box, found after ProjectModal mounts — the portal target for the action row. */
  const [modalNode, setModalNode] = useState<HTMLElement | null>(null);
  /** Mirrors the real submit's disabled state so our buttons match ITS validation exactly. */
  const [submitDisabled, setSubmitDisabled] = useState(true);

  /**
   * THE SEAM. ProjectModal's submit is the last button inside .tt-modalacts (ProjectModal.tsx:
   * 215-220). Structural, deliberately NOT textual: matching the label "Create project" is the
   * obvious approach and the wrong one — that string is a ternary in another module's file, and a
   * copy edit there would break this wizard silently. A class plus a position survives a rename.
   */
  const findSubmit = (): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>(".emp-projecthost .tt-modalacts button:last-of-type");

  // The children have mounted by the time an effect runs, so the modal box exists here. Both the
  // portal target and the submit are resolved once, and the submit's disabled state is then WATCHED
  // — ProjectModal's internal state changes do not re-render this component, so an observer is the
  // only way our buttons can track its validation instead of guessing at it.
  useEffect(() => {
    setModalNode(document.querySelector<HTMLElement>(".emp-projecthost .tt-modal"));
    const submit = findSubmit();
    if (!submit) {
      setSeamBroken(true);
      return;
    }
    setSubmitDisabled(submit.disabled);
    const observer = new MutationObserver(() => setSubmitDisabled(submit.disabled));
    observer.observe(submit, { attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, []);

  const go = (createEmployeeNext: boolean) => (): void => {
    const submit = findSubmit();
    if (!submit) {
      setSeamBroken(true);
      return;
    }
    setThenCreate(createEmployeeNext);
    // queueMicrotask so the destination state above has landed before onSaved can fire. click()
    // works on a display:none button — visibility is irrelevant to programmatic activation — and
    // routing through it keeps ProjectModal's validation, saving state and error banner ITS job.
    queueMicrotask(() => submit.click());
  };

  const actions = (
    <div className="emp-hostacts">
      {seamBroken && (
        <div className="emp-error" role="alert">
          <span className="emp-error-plain">Couldn&apos;t reach the project form&apos;s save button.</span>
          <span className="emp-error-hint">
            Nothing was created. Add the project from TimeTracker instead, then come back and use
            Assign To Project.
          </span>
        </div>
      )}
      <button className="emp-btn ghost" onClick={onClose}>
        Cancel
      </button>
      <button className="emp-btn" disabled={submitDisabled || seamBroken} onClick={go(false)}>
        Add Project
      </button>
      <button className="emp-btn primary" disabled={submitDisabled || seamBroken} onClick={go(true)}>
        Add Project + Create Employee
      </button>
    </div>
  );

  return (
    <div className="emp-projecthost">
      <ProjectModal
        state={{ mode: "new" }}
        groups={groups}
        onClose={onClose}
        onSaved={(p) => (thenCreate ? onSavedGoToEmployee(p) : onSavedStop(p))}
      />
      {/*
        The drawn three-button row, PORTALLED INTO the modal box so it is a real DOM child sitting
        below the form — not a floating bar. ProjectModal's own action row is hidden by CSS within
        this host, so the user sees exactly these three and never two competing Cancels.
        A portal rather than a sibling because .tt-modal is the scrolling, bordered, themed surface;
        anything positioned outside it would drift the moment the form grows or the window resizes.
      */}
      {modalNode ? createPortal(actions, modalNode) : null}
    </div>
  );
}
