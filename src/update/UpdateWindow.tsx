/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Software Update window (mockup R2). Consent-first: nothing downloads until the user clicks.
// The Summary (from the feed's releaseNotes) sits in a FIXED-HEIGHT box that never scrolls; the
// "Show full details" panel fetches REVISIONS.md from the feed root and DOES scroll. Required
// mode (major bump) offers only Install now / Quit; unmaintained mode nags with Update now / Later.
import { useEffect, useState } from "react";

type Mode = "normal" | "required" | "unmaintained";
interface InitState {
  current: string;
  incoming: string;
  notes: string;
  mode: Mode;
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

  useEffect(() => {
    void window.updateApi.init().then((s) => {
      if (s) setSt(s);
    });
    const offState = window.updateApi.onState((s) => setSt(s)); // re-offer into an already-open window
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

      <div className="upd-notes">{st.notes || "No release notes were provided for this version."}</div>

      <button className="upd-disclose" onClick={toggleDetails} aria-expanded={open}>
        <span className={"upd-chev" + (open ? " open" : "")} aria-hidden="true">›</span>
        {open ? "Hide full details" : "Show full details"}
      </button>
      {open && (
        <div className="upd-details">
          {details === "loading" && <div className="upd-dim">Loading details…</div>}
          {details === "failed" && <div className="upd-dim">Details unavailable — see the full changelog below.</div>}
          {Array.isArray(details) &&
            details.map((g) => (
              <div key={g.head}>
                <h2>{g.head}</h2>
                <ul>
                  {g.items.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

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
