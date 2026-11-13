/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Settings → Data. "Back up everything now" copies every database, the two key files and
// TimeTracker's attached files into a new dated folder. The copy runs in the main process
// (electron/core/services/data); this pane starts it and shows where it goes and when it last ran.
// The wording on the page stays clear of how the data is stored: it says what a backup is for.
import { useEffect, useState } from "react";
import { signalAppAsk, signalAppToast } from "../App";
import { formatStamp } from "../shared/datetime";
import type { DataCopyStatus } from "../shared/types";

// Outside the component on purpose: closing Settings unmounts this pane, and a backup that is
// still running must show as running, and answer exactly once, when Settings is opened again.
let inFlight: Promise<void> | null = null;

function startCopy(): Promise<void> {
  if (inFlight) return inFlight;
  const run = window.api.dataCopy
    .run()
    .then((result) => {
      if (result.ok) {
        const finished = result.path;
        signalAppAsk("Backup finished", finished, [
          { label: "Show in folder", primary: true, onClick: () => void window.api.dataCopy.reveal(finished) },
        ]);
      } else {
        // The half-made folder is named, so it is never mistaken for a backup.
        const left = result.path ? ` What was copied is in "${result.path}".` : "";
        signalAppToast(`Backup did not finish. ${result.error}${left}`, "err");
      }
    })
    .catch((err: unknown) => signalAppToast(`Backup did not finish. ${err instanceof Error ? err.message : String(err)}`, "err"))
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

export function SettingsData() {
  const [status, setStatus] = useState<DataCopyStatus | null>(null);
  const [busy, setBusy] = useState(inFlight !== null);

  const load = (): void => {
    void window.api.dataCopy
      .status()
      .then(setStatus)
      .catch((err: unknown) => console.error("[data] could not read the backup status:", err));
  };
  const settle = (): void => {
    setBusy(false);
    load();
  };

  useEffect(() => {
    load();
    void inFlight?.then(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backUp = (): void => {
    setBusy(true);
    void startCopy().then(settle);
  };
  const changeFolder = (): void => {
    void window.api.dataCopy
      .pickFolder()
      .then((picked) => {
        if (picked) load();
      })
      .catch((err: unknown) => signalAppToast(err instanceof Error ? err.message : String(err), "err"));
  };
  const lastRun = status === null ? "…" : status.lastAt ? formatStamp(status.lastAt, "eventTime") : "none yet";

  return (
    <>
      <h2>Data</h2>
      <p className="hint" style={{ marginBottom: 18 }}>
        A backup is a full copy of everything you have entered in Focal Registry, written to a new dated folder
        while the app stays open.
      </p>
      <div className="field">
        <div className="setrow">
          <label>Backup</label>
          <button className="btn" onClick={backUp} disabled={busy}>
            {busy ? "Backing up…" : "Back up everything now"}
          </button>
        </div>
        <p className="hint">
          Last backup: {lastRun}. The window can pause for a few seconds while a backup runs.
        </p>
      </div>
      <div className="field" style={{ marginTop: 22 }}>
        <label>Backup folder</label>
        <button
          className="pathrow"
          title="Show this folder"
          onClick={() => {
            if (status) void window.api.dataCopy.reveal(status.folder);
          }}
        >
          {status?.folder ?? "…"}
        </button>
        <div className="setrow" style={{ marginTop: 8 }}>
          <button className="btn" onClick={changeFolder} disabled={busy}>
            Change folder…
          </button>
        </div>
        <p className="hint">
          Each backup is a new folder named by its date and time; the first one creates this folder. Nothing in it is
          ever overwritten or removed by the app. A backup goes back onto this PC under this Windows account: anywhere
          else, the Secured Vault and the pictures in MindMerge will not open from it.
        </p>
      </div>
      {/* DS-02 mounts here */}
      {/* MM-09 mounts here */}
    </>
  );
}
