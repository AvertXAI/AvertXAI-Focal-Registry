/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Software Update window (mockup R2). Consent-first: nothing downloads until the user clicks.
// The Summary (from the feed's releaseNotes) fills the box between the header and the disclosure,
// headed "Revisions Update <date>" with one bullet per sentence (Jason's mockup, 09-10-2026);
// "Show full details" fetches REVISIONS.md from the feed root and shows it IN THE SAME BOX in place
// of the summary — one box, two views, never a second panel. Required mode (major bump) offers only
// Install now / Quit; unmaintained mode nags with Update now / Later.
import { useEffect, useRef, useState } from "react";

type Mode = "normal" | "required" | "unmaintained";
interface InitState {
  current: string;
  incoming: string;
  notes: string;
  mode: Mode;
  date?: string; // the feed's releaseDate, ISO; absent on an older manifest
}

/** "September 10, 2026" from the feed's ISO releaseDate; null when absent or unparseable. */
function releaseDay(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** The Summary is written as sentences (release.mjs caps it at 400 characters); each becomes a
    bullet. Split where a sentence ends — a period, question or exclamation mark, optionally followed
    by a closing quote — and a capital letter starts the next. "Ctrl+S" mid-sentence is safe (no
    space after the period); an "e.g." followed by a capitalised word would split, so the Summary
    should not use it. A one-sentence Summary is one bullet. */
function bullets(notes: string): string[] {
  return notes
    .split(/(?<=[.!?]["”]?)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
interface Progress {
  percent: number;
  transferred: number;
  total: number;
}

interface DetailGroup {
  head: string;
  items: string[];
}

// Bridge exposed by electron/update-preload.ts — this window's ONLY IPC surface (no window.api).
// The full-details fetch+parse lives MAIN-side (updwin:details) — no CORS, no server header needed.
declare global {
  interface Window {
    updateApi: {
      init: () => Promise<InitState | null>;
      details: () => Promise<DetailGroup[] | null>;
      download: () => Promise<void>;
      install: () => void;
      skip: () => void;
      later: () => void;
      quit: () => void;
      openReleases: () => void;
      onState: (cb: (s: InitState) => void) => () => void;
      onProgress: (cb: (p: Progress) => void) => () => void;
      onDownloaded: (cb: () => void) => () => void;
    };
  }
}

const megabytes = (bytes: number): string => (bytes / 1048576).toFixed(1);

export default function UpdateWindow() {
  const [st, setSt] = useState<InitState | null>(null);
  const [stage, setStage] = useState<"idle" | "downloading" | "ready">("idle");
  const [prog, setProg] = useState<Progress | null>(null);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<DetailGroup[] | "loading" | "failed" | null>(null);
  /** The incoming version the window is currently showing — so a re-offer can tell "same version,
      refreshed" from "a newer version landed". */
  const shown = useRef<string | null>(null);

  useEffect(() => {
    void window.updateApi.init().then((s) => {
      if (s) {
        shown.current = s.incoming;
        setSt(s);
      }
    });
    // Re-offer into an already-open window. A DIFFERENT version arriving must drop the fetched
    // details and fall back to the summary view — they were parsed for the old version.
    const offState = window.updateApi.onState((s) => {
      if (shown.current !== null && shown.current !== s.incoming) {
        setDetails(null);
        setOpen(false);
      }
      shown.current = s.incoming;
      setSt(s);
    });
    const offProgress = window.updateApi.onProgress((p) => {
      setStage("downloading");
      setProg(p);
    });
    const offDone = window.updateApi.onDownloaded(() => setStage("ready"));
    return () => {
      offState();
      offProgress();
      offDone();
    };
  }, []);

  const toggleDetails = () => {
    const next = !open;
    setOpen(next);
    if (next && details === null && st) {
      setDetails("loading");
      window.updateApi
        .details()
        .then((groups) => setDetails(groups ?? "failed"))
        .catch(() => setDetails("failed"));
    }
  };

  const startDownload = () => {
    setStage("downloading");
    setProg({ percent: 0, transferred: 0, total: 0 });
    void window.updateApi.download().catch(() => {}); // failures surface via the updater's own logging
  };

  if (!st) return null;
  const required = st.mode === "required";
  const unmaintained = st.mode === "unmaintained";
  const primary = () => (stage === "ready" ? window.updateApi.install() : startDownload());
  const primaryLabel = stage === "ready" ? "Restart and install" : required ? "Install now" : unmaintained ? "Update now" : "Install update";

  return (
    <>
      {/* Frameless window: this drag strip IS the title bar ("Software Update"); the OS draws the
          caption buttons above it, themed by the constructor's titleBarOverlay. */}
      <div className="upd-titlebar">Software Update</div>
      <div className="upd">
      {required && <div className="upd-bar required">Required update — this version must be installed to continue.</div>}
      {unmaintained && <div className="upd-bar unmaintained">Your version is no longer maintained.</div>}

      <div className="upd-head">
        <div className="upd-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v13" />
            <path d="M6 11l6 6 6-6" />
            <path d="M4 21h16" />
          </svg>
        </div>
        <div className="upd-headtext">
          <h1>A new version of Focal Registry is available!</h1>
          <div className="upd-pills">
            <span className="upd-pill">{st.current}</span>
            <span className="upd-arrow" aria-hidden="true">→</span>
            <span className="upd-pill new">{st.incoming}</span>
          </div>
        </div>
      </div>

      {/* ONE BOX, TWO VIEWS (Jason 09-10-2026: "we need the windows to switch, not add a new
          window"). The summary and the full details take turns in the same box; the disclosure
          below swaps them. The heading stays in both. */}
      <div className="upd-notes">
        <h2>Revisions Update{releaseDay(st.date) ? ` ${releaseDay(st.date)}` : ""}</h2>
        {open ? (
          <div className="upd-details">
            {details === "loading" && <div className="upd-dim">Loading details…</div>}
            {details === "failed" && <div className="upd-dim">Details unavailable — see the full changelog below.</div>}
            {Array.isArray(details) &&
              details.map((g) => (
                <div key={g.head}>
                  <h3>{g.head}</h3>
                  <ul>
                    {g.items.map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        ) : st.notes ? (
          <ul>
            {bullets(st.notes).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : (
          <div className="upd-dim">No release notes were provided for this version.</div>
        )}
      </div>

      <button className="upd-disclose" onClick={toggleDetails} aria-expanded={open}>
        <span className={"upd-chev" + (open ? " open" : "")} aria-hidden="true">›</span>
        {open ? "Back to summary" : "Show full details"}
      </button>

      {stage !== "idle" && (
        <div className="upd-progress">
          <div className="upd-progress-track">
            <div className="upd-progress-fill" style={{ width: `${stage === "ready" ? 100 : prog?.percent ?? 0}%` }} />
          </div>
          <div className="upd-progress-text">
            {stage === "ready"
              ? "Download complete — ready to install."
              : prog && prog.total > 0
                ? `${prog.percent}% · ${megabytes(prog.transferred)} of ${megabytes(prog.total)} megabytes`
                : "Starting download…"}
          </div>
        </div>
      )}

      <button className="upd-link" onClick={() => window.updateApi.openReleases()}>
        Full changelog: focalregistry.com/releases
      </button>

      <div className="upd-actions">
        {required ? (
          <>
            <button className="upd-btn" onClick={() => window.updateApi.quit()}>Quit</button>
            <button className="upd-btn primary" disabled={stage === "downloading"} onClick={primary}>{primaryLabel}</button>
          </>
        ) : (
          <>
            {!unmaintained && (
              <button className="upd-btn ghost" disabled={stage !== "idle"} onClick={() => window.updateApi.skip()}>
                Skip this version
              </button>
            )}
            <button className="upd-btn" disabled={stage === "downloading"} onClick={() => window.updateApi.later()}>
              {unmaintained ? "Later" : "Remind me later"}
            </button>
            <button className="upd-btn primary" disabled={stage === "downloading"} onClick={primary}>{primaryLabel}</button>
          </>
        )}
      </div>
      </div>
    </>
  );
}
