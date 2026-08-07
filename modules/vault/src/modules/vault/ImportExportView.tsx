/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Import / Export — its OWN tab and its own rail entry, exactly where the mockup puts them
// (surface 8's card list, plus the tab strip and the TOOLS rail).
//
// Import is real: the workbook we already ship is the fixture, and the mapping step is the whole
// point — nothing is written until the user has seen what will be created. Export is deliberately
// the most reluctant screen in the vault, because it is the one action that takes secrets out from
// behind the encryption. Both are marked not-built where they are not built, in orange, which is
// the convention Jason confirmed for exactly this.
import { useState } from "react";
import { vaultApi } from "./vaultApi";

const SOURCES: [string, string][] = [
  ["chrome", "Chrome"],
  ["firefox", "Firefox"],
  ["edge", "Edge"],
  ["brave", "Brave"],
  ["1password", "1Password"],
  ["bitwarden", "Bitwarden"],
  ["lastpass", "LastPass"],
  ["dashlane", "Dashlane"],
  ["keepass", "KeePass"],
  ["keeper", "Keeper"],
  ["roboform", "RoboForm"],
  ["csv", "Other / CSV"],
];

export default function ImportExportView({ onImported }: { onImported: () => void }) {
  const api = vaultApi();
  const [source, setSource] = useState<string | null>(null);
  const [exportKind, setExportKind] = useState<"encrypted" | "plain">("encrypted");
  const [confirmed, setConfirmed] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      {/* ---- IMPORT ---- */}
      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Import</span>
          <span className="vault-hint">Nothing is written until you review the mapping</span>
        </div>
        <div className="vault-sourcegrid">
          {SOURCES.map(([key, label]) => (
            <button key={key} className={`vault-source${source === key ? " on" : ""}`} onClick={() => setSource(key)}>
              <span className="vault-sourcename">{label}</span>
            </button>
          ))}
        </div>

        {source && (
          <div className="vault-card" style={{ marginTop: 14, marginBottom: 0, background: "var(--mc-nested)" }}>
            <div className="vault-cardhead">
              <span className="vault-cardtitle" style={{ color: "var(--mc-orange)" }}>
                Choose a file · map the columns
              </span>
              <span className="vault-kind" style={{ color: "var(--mc-orange)", borderColor: "var(--mc-orange)" }}>
                Not built
              </span>
            </div>
            <div className="vault-hint">
              The next step reads the file's header row and lets you say which column is the site, which is the
              username, and which is the password. A preview shows exactly what will be created — how many entries, and
              any rows that cannot be read — <b>before a single one is written</b>. Nothing is imported by surprise.
            </div>
            <div className="vault-hint" style={{ marginTop: 10 }}>
              An exported password file is plain text sitting on your disk. When the import finishes, delete it — the
              vault will remind you.
            </div>
          </div>
        )}

        {/* The sample workbook IS the import fixture — same columns, same shape. It is the fastest
            way to see what an import produces without exporting anything real first. */}
        <div className="vault-hint" style={{ marginTop: 14 }}>
          Want to see what an import looks like first? The sample set loads 46 made-up entries with the same columns a
          real export has.
        </div>
        <div className="vault-btnrow" style={{ marginTop: 8 }}>
          <button
            className="vault-btn"
            disabled={seedBusy}
            onClick={() => {
              setSeedBusy(true);
              setMessage(null);
              void api
                .loadSeed()
                .then((r) => setMessage(r.ok ? `Loaded ${r.created} sample entries.` : (r.error ?? "That did not work.")))
                .catch((e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
                .finally(() => {
                  setSeedBusy(false);
                  onImported();
                });
            }}
          >
            {seedBusy ? "Loading…" : "Load the sample set"}
          </button>
        </div>
        {message && <div className="vault-hint" style={{ marginTop: 8 }}>{message}</div>}
      </div>

      {/* ---- EXPORT ---- */}
      <div className="vault-card" style={{ borderColor: exportKind === "plain" ? "var(--vault-danger-color)" : undefined }}>
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Export</span>
          <span className="vault-kind" style={{ color: "var(--mc-orange)", borderColor: "var(--mc-orange)" }}>
            Not built
          </span>
        </div>
        <div className="vault-opts" style={{ gridTemplateColumns: "1fr" }}>
          <label className="vault-opt">
            <input type="radio" name="exp" checked={exportKind === "encrypted"} onChange={() => { setExportKind("encrypted"); setConfirmed(false); }} />
            <span>
              <b>Encrypted archive</b> — restorable only into a vault
            </span>
          </label>
          <label className="vault-opt">
            <input type="radio" name="exp" checked={exportKind === "plain"} onChange={() => { setExportKind("plain"); setConfirmed(false); }} />
            <span>
              <b>Plain CSV</b> — <span style={{ color: "var(--vault-danger-color)" }}>every secret readable by anyone who opens the file</span>
            </span>
          </label>
        </div>

        {exportKind === "plain" && (
          <div className="vault-card" style={{ marginTop: 12, marginBottom: 0, background: "var(--mc-nested)", borderColor: "var(--vault-danger-color)" }}>
            <div className="vault-cardtitle" style={{ color: "var(--vault-danger-color)", marginBottom: 8 }}>
              A plain export leaves the vault
            </div>
            <div className="vault-hint">
              The moment that file is written, the encryption, the access log and the version history stop protecting
              anything in it. It is a list of your passwords in a file anyone can open — including anything that reads
              your Downloads folder. The export itself is recorded in the access log, and <b>that record is permanent</b>.
            </div>
            <label className="vault-opt" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I understand, and I will delete the file when I am done with it
            </label>
          </div>
        )}

        <div className="vault-btnrow" style={{ marginTop: 12 }}>
          <button className={`vault-btn${exportKind === "plain" ? " danger" : ""}`} disabled={exportKind === "plain" && !confirmed}>
            {exportKind === "plain" ? "Export as plain CSV" : "Export encrypted archive"}
          </button>
        </div>
      </div>
    </>
  );
}
