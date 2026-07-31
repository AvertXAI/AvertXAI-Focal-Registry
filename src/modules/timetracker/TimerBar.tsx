/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// TimeTracker timer bar — full standalone parity (Phase 4.5). Three states:
//   IDLE:    hourglass + IDLE · live date-time · PROJECT/CLIENT/CONTACT/SESSION NOTE fields ·
//            big segmented clock with IDLE beneath · green Start.
//   RUNNING: red REC dot + REC · clock counts up · "• RECORDING" · LIVE dollar count-up for
//            hourly projects (rate × elapsed, every tick; non-hourly shows nothing, never $0.00) ·
//            amber Pause · red Stop & Save · "Started …   Elapsed …" line.
//   PAUSED:  Resume replaces Pause; clock and dollars HOLD (frozen accumulator, main-side truth).
// A dumb view over the timetracker:tick push; its only own timekeeping is the 1s wall-clock for
// the top-right date-time. On Stop the fields deliberately stay filled for the next round.
import { useEffect, useRef, useState } from "react";
import type { TimeTrackerActiveSessionInfo, TimeTrackerProjectListItem, TimeTrackerTickSession } from "../../shared/types";

interface Props {
  projects: TimeTrackerProjectListItem[];
  project: TimeTrackerProjectListItem | null;
  session: TimeTrackerActiveSessionInfo | null;
  tickSession: TimeTrackerTickSession | null;
  onSelectProject: (id: number) => void;
  onStart: (note: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const clock = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtTime12 = (d: Date): string => {
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")} ${ampm}`;
};
const fmtLiveNow = (d: Date): string =>
  `${WEEKDAYS[d.getDay()]} ${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()} · ${fmtTime12(d)}`;
const fmtMoneyLive = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Project picker with a colour dot PER OPTION — a native <select> cannot render the dots, so this
    is a minimal button+list dropdown. Closes on outside click via a transparent backdrop. */
function ProjectSelect({ projects, project, disabled, onSelect }: {
  projects: TimeTrackerProjectListItem[];
  project: TimeTrackerProjectListItem | null;
  disabled: boolean;
  onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tt-psel">
      <button className="tt-input tt-pselbtn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        {project ? (
          <><span className="tt-dot" style={{ background: project.color }} /><span className="tt-pselname">{project.name}</span></>
        ) : (
          <span className="tt-pselname dim">Pick a project…</span>
        )}
        <span className="tt-pselcaret">▾</span>
      </button>
      {open && (
        <>
          <div className="tt-pselback" onClick={() => setOpen(false)} />
          <div className="tt-psellist" role="listbox">
            {projects.map((p) => (
              <button key={p.id} className={"tt-pselopt" + (p.id === project?.id ? " on" : "")} role="option"
                aria-selected={p.id === project?.id}
                onClick={() => { onSelect(p.id); setOpen(false); }}>
                <span className="tt-dot" style={{ background: p.color }} />
                <span className="tt-pselname">{p.name}</span>
              </button>
            ))}
            {projects.length === 0 && <div className="tt-pselopt dim">No projects yet</div>}
          </div>
        </>
      )}
    </div>
  );
}

function HourglassIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 2h8M4 14h8M5 2c0 3.2 2 4.2 3 6-1 1.8-3 2.8-3 6M11 2c0 3.2-2 4.2-3 6 1 1.8 3 2.8 3 6" />
    </svg>
  );
}

export default function TimerBar({ projects, project, session, tickSession, onSelectProject, onStart, onPause, onResume, onStop }: Props) {
  const [note, setNote] = useState("");
  // 1s wall clock for the live date-time (the tick push only fires while a session exists).
  const [now, setNow] = useState(() => new Date());
  const noteRef = useRef(note);
  noteRef.current = note;
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const running = session !== null && session.state === "running";
  const paused = session !== null && session.state === "paused";
  const live = session !== null;

  const seconds = tickSession
    ? tickSession.elapsedMs / 1000
    : session
      ? session.state === "paused"
        ? session.accumulatedSeconds
        : Math.max(0, (Date.now() - Date.parse(session.startedAt)) / 1000)
      : 0;

  // LIVE dollar count-up — hourly only, computed here on every render the tick drives:
  // dollars = hourly_rate × (elapsed seconds ÷ 3600). Paused holds because `seconds` holds.
  // The tick payload's own `earned` is the same formula main-side; local compute also covers
  // the pre-first-tick frame. Non-hourly renders NOTHING (never $0.00).
  const dollars = project && project.rate_type === "hourly" && project.hourly_rate
    ? (seconds / 3600) * project.hourly_rate
    : null;

  const startedAt = session ? new Date(session.wallStartedAt) : null;

  return (
    <div>
      <div className={"tt-bar2" + (running ? " running" : "") + (paused ? " paused" : "")}>
        <div className="tt-bar2top">
          <span className={"tt-state" + (live ? " rec" : "")}>
            {live ? <span className="tt-recdot" aria-hidden="true" /> : <HourglassIcon />}
            {live ? "REC" : "IDLE"}
          </span>
          <span className="tt-livedate">{fmtLiveNow(now)}</span>
        </div>

        <div className="tt-bar2mid">
          <div className="tt-fields">
            <label className="tt-bfield">
              <span>Project</span>
              <ProjectSelect projects={projects} project={project} disabled={live} onSelect={onSelectProject} />
            </label>
            <label className="tt-bfield">
              <span>Client</span>
              <span className="tt-input tt-ro">{project?.client_name ?? "—"}</span>
            </label>
            <label className="tt-bfield">
              <span>Contact</span>
              <span className="tt-input tt-ro">{project?.contact_phone || "—"}</span>
            </label>
            <label className="tt-bfield">
              <span>Session note</span>
              <input className="tt-input" placeholder="optional..." value={live ? (session?.note ?? note) : note}
                disabled={live} aria-label="Session note"
                onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          <div className="tt-clockblock">
            <span className={"tt-clock2"}>{clock(seconds)}</span>
            <span className={"tt-clocklabel" + (running ? " rec" : "")}>
              {running ? "• RECORDING" : paused ? "PAUSED" : "IDLE"}
            </span>
            {dollars !== null && live && <span className="tt-dollars">{fmtMoneyLive(dollars)}</span>}
          </div>

          <div className="tt-barbtns">
            {!live && (
              <button className="tt-btn start" disabled={!project} onClick={() => onStart(noteRef.current)}>Start</button>
            )}
            {running && <button className="tt-btn pause" onClick={onPause}>Pause</button>}
            {paused && <button className="tt-btn start" onClick={onResume}>Resume</button>}
            {live && <button className="tt-btn stopsave" onClick={onStop}>Stop &amp; Save</button>}
          </div>
        </div>

        {live && startedAt && !Number.isNaN(startedAt.getTime()) && (
          <div className="tt-startedline">
            Started {fmtTime12(startedAt)}
            <span className="tt-startedgap" />
            Elapsed {clock(seconds)}
          </div>
        )}
      </div>
      <div className="tt-barhint">
        Live — nothing is written until you hit Stop. · On stop, the session saves but the
        Project / Client / Contact fields stay filled for your next round.
      </div>
    </div>
  );
}
