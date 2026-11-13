/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Settings, Data: "Export all data…". One button for every module: the main process writes each
// database to a folder he picks, as plain files another app can read. The Vault goes along as its
// encrypted file unless the box below is ticked.
import { useState } from "react";
import { signalAppAsk, signalAppToast } from "../../App";

const count = (n: number, word: string): string => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

export function ExportRow() {
  // ponytail: "busy" lives in this row, so closing and reopening Settings during an export shows
  // the button as ready again. Main still refuses a second run and says so. Keep the running
  // promise outside the component if that is ever seen.
  const [busy, setBusy] = useState(false);
  const [includeVault, setIncludeVault] = useState(false);

  const run = async (): Promise<void> => {
    try {
      const folder = await window.api.dataExport.pickFolder();
      if (!folder) return;
      setBusy(true);
      const r = await window.api.dataExport.run({ folder, includeVault });
      if (!r.ok) {
        signalAppToast(r.error, "err");
        return;
      }
      // The folder's name, not its whole path: a long path cannot wrap and would push the toast
      // off a narrow window. "Show in folder" is how he gets to the place.
      const name = r.path.split(/[\\/]/).pop() ?? r.path;
      signalAppAsk(
        "Export finished",
        `${count(r.tables, "table")} and ${count(r.rows, "row")} are in ${name}.` +
          (includeVault ? " The Secured Vault is in it as plain text." : ""),
        [
          {
            label: "Show in folder",
            primary: true,
            onClick: () => void window.api.dataExport.reveal().catch(() => signalAppToast("The folder could not be opened.", "err")),
          },
        ]
      );
      // A box that puts passwords in plain text does not stay ticked for the next export.
      setIncludeVault(false);
    } catch (e) {
      signalAppToast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 22 }}>
      <div className="field">
        <div className="setrow">
          <label>Export</label>
          <button className="btn" onClick={() => void run()} disabled={busy}>
            {busy ? "Exporting…" : "Export all data…"}
          </button>
        </div>
        <p className="hint">
          Writes everything the app keeps in its databases to a folder you choose, as plain files another
          app can read: a folder for each module, a file for each table, and MindMerge pictures as ordinary
          picture files. Nothing in the app is changed. The folder is not encrypted and holds client and
          employee details, so keep it somewhere private.
        </p>
      </div>
      {/* Outside .field on purpose: ".field label" would restyle this label as a bold row title. */}
      <label className={"fb-check" + (includeVault ? " on" : "")}>
        <input
          type="checkbox"
          checked={includeVault}
          disabled={busy}
          onChange={(e) => setIncludeVault(e.target.checked)}
        />
        <span>
          Include the Secured Vault as plain text{" "}
          {/* The shell has no danger token; this is the literal its other warnings use. */}
          <span style={{ color: "#e0574f" }}>(anyone with this folder can read your passwords)</span>
        </span>
      </label>
      <p className="hint">
        Left unticked, the Vault goes along as its encrypted file, which opens only on this PC under this
        Windows account. To tick it, unlock the Vault first.
      </p>
    </div>
  );
}
