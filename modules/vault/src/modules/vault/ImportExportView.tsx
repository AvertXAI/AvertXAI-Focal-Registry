/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Import / Export — its OWN tab and its own rail entry, exactly where the mockup puts them
// (surface 8's card list, plus the tab strip and the TOOLS rail).
//
// BOTH SIDES ARE NOW REAL. What used to be two orange "Not built" cards is a working mapping step
// and a working writer; the orange badges are gone because the thing they described exists.
//
// The discipline the screen is built around: NOTHING IS WRITTEN UNTIL THE MAPPING HAS BEEN SEEN.
// Import is two calls on purpose — preview() reads the header row and five sample lines and writes
// nothing at all, and only the Import button calls the one that writes. Export is the reluctant
// direction: a plain CSV is the single action in this product that takes secrets out from behind
// the encryption, so the screen says so plainly and makes you tick a box first.
//
// No path is typed and no value is handled here. The renderer asks main for a dialog, hands back
// the path it was given, and receives counts — see transfer.ts for why that matters.
import { useState } from "react";
import { vaultApi, type VaultExportCandidate, type VaultImportMapping, type VaultImportPreview, type VaultImportResult } from "./vaultApi";

// Every one of these exports a CSV, so they all share one code path — the picker sets expectations
// and gives the mapping step a name to put in its heading, nothing more. "AvertXAI archive" is the
// odd one out and is handled separately, because an archive needs a passphrase and no mapping.
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
  ["archive", "AvertXAI archive"],
];

const FIELDS: [keyof VaultImportMapping, string, boolean][] = [
  ["label", "Name", true],
  ["value", "Password", true],
  ["username", "Username", false],
  ["url", "Website", false],
  ["notes", "Notes", false],
];

// How to PRODUCE the export, per source — because once "where is the file" is answered by the scan,
// the only question left is "how do I make one". One or two lines each; the vault cannot press these
// buttons for the user (they sit behind the source's own re-authentication, by that source's design).
const HOWTO: Record<string, string> = {
  chrome: "Chrome → ⋮ → Passwords and autofill → Google Password Manager → Settings → Export passwords. It saves to your Downloads.",
  edge: "Edge → ⋯ → Settings → Profiles → Passwords → ⋯ → Export passwords. It saves to your Downloads.",
  brave: "Brave → ☰ → Password Manager → Settings → Export passwords. It saves to your Downloads.",
  firefox: "Firefox → ☰ → Passwords → ⋯ (top-right) → Export Logins. Choose where it saves.",
  "1password": "1Password → File → Export → your account → CSV. Choose where it saves.",
  bitwarden: "Bitwarden → Tools → Export vault → File format CSV → Export vault. It saves to your Downloads.",
  lastpass: "LastPass → Advanced Options → Export → CSV. Copy the text into a .csv file if it opens in the browser.",
  dashlane: "Dashlane → My account → Settings → Export data → Export to CSV. It saves to your Downloads.",
  keepass: "KeePass → File → Export → CSV → choose where it saves. (KeePassXC: Database → Export → CSV.)",
  keeper: "Keeper → Account → Settings → Export → Export to CSV file.",
  roboform: "RoboForm → Options → Account & Data → Export → Logins as CSV.",
  csv: "Any exporter that writes a CSV with a header row will do — the next step lets you say which column is which.",
  archive: "An AvertXAI archive is a file this vault wrote from its own Export tab. Only its passphrase opens it.",
};

const kindLabel = (key: string): string => SOURCES.find(([k]) => k === key)?.[1] ?? key;
const kb = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`);
/** "today" / "yesterday" / "3 days ago" — a found file's age is the strongest signal it is the
    right one, so it is said in words rather than a raw timestamp. */
const relTime = (ms: number): string => {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
};

export default function ImportExportView({ onImported }: { onImported: () => void }) {
  const api = vaultApi();
  const [source, setSource] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<VaultExportCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [preview, setPreview] = useState<VaultImportPreview | null>(null);
  const [mapping, setMapping] = useState<VaultImportMapping | null>(null);
  const [result, setResult] = useState<VaultImportResult | null>(null);
  const [importPass, setImportPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exportKind, setExportKind] = useState<"encrypted" | "plain">("encrypted");
  const [confirmed, setConfirmed] = useState(false);
  const [exportPass, setExportPass] = useState("");
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [seedBusy, setSeedBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isArchive = source === "archive";

  /** Picking a different source abandons whatever was half-mapped — carrying a Chrome mapping onto
      a KeePass file would silently map the wrong columns, which is the exact failure this screen
      exists to prevent. Then it AUTO-SCANS for that source's export, so the common case is "it
      already found the file" rather than "go hunt for it". */
  const pickSource = (key: string): void => {
    setSource(key);
    setFile(null);
    setCandidates(null);
    setPreview(null);
    setMapping(null);
    setResult(null);
    setError(null);
    setImportPass("");
    setScanning(true);
    void api
      .findExports(key)
      .then(setCandidates)
      .catch(() => setCandidates([])) // a scan that fails just means "nothing found — use the dialog"
      .finally(() => setScanning(false));
  };

  /** Reads a path's header row so the columns can be mapped. Shared by the scan result and the
      dialog, so a found file and a chosen file go through byte-identical code. */
  const previewPath = (path: string): void => {
    setFile(path);
    if (isArchive) return; // an archive has no columns to map; it needs a passphrase instead
    setBusy(true);
    setError(null);
    void api
      .importPreview(path)
      .then((p) => {
        setPreview(p);
        setMapping(p.guess); // pre-filled from the header row; the human confirms or corrects
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const chooseFile = (): void => {
    setError(null);
    setResult(null);
    void api
      .chooseImportFile(isArchive ? "archive" : source ?? "csv")
      .then((path) => {
        if (!path) return; // cancelled — not an error, and nothing should change on screen
        previewPath(path);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const runImport = (): void => {
    if (!file) return;
    setError(null);
    setBusy(true);
    const job = isArchive ? api.importArchive(file, importPass) : api.importCsv(file, mapping as VaultImportMapping);
    void job
      .then((r) => {
        setResult(r);
        onImported();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const runExport = (): void => {
    setExportMessage(null);
    setExporting(true);
    void api
      .exportVault(exportKind === "plain" ? "csv" : "archive", exportPass)
      .then((r) => {
        // null means the save dialog was cancelled. Saying "cancelled" is more honest than saying
        // nothing, because a silent no-op reads exactly like a failure.
        if (!r) return setExportMessage("Cancelled — nothing was written.");
        setExportMessage(`${r.count} entries written to ${r.path}`);
        setConfirmed(false);
        setExportPass("");
      })
      .catch((e: unknown) => setExportMessage(e instanceof Error ? e.message : String(e)))
      .finally(() => setExporting(false));
  };

  const shortFile = (p: string): string => p.split(/[\\/]/).pop() ?? p;
  const canImport = isArchive
    ? Boolean(file) && importPass.length >= 8
    : Boolean(file && mapping && mapping.label >= 0 && mapping.value >= 0);

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
            <button key={key} className={`vault-source${source === key ? " on" : ""}`} onClick={() => pickSource(key)}>
              <span className="vault-sourcename">{label}</span>
            </button>
          ))}
        </div>

        {source && (
          <div className="vault-card" style={{ marginTop: 14, marginBottom: 0, background: "var(--mc-nested)" }}>
            <div className="vault-cardhead">
              <span className="vault-cardtitle">
                {isArchive ? "Choose the archive · enter its passphrase" : "Choose a file · map the columns"}
              </span>
              <div className="vault-btnrow">
                <button className="vault-btn" onClick={() => void api.revealExportFolder(source, file ?? "")}>
                  Open the folder
                </button>
                <button className="vault-btn primary" disabled={busy} onClick={chooseFile}>
                  {file ? "Choose a different file" : "Choose a file"}
                </button>
              </div>
            </div>

            {/* ---- the scan. Clicking a source looks in the folders that source drops its export
                    into and lists what it found, so the usual answer to "where is the file" is
                    "here it is" and not a file dialog. Reading names only — never a browser's own
                    store, never the file's contents until you pick one. ---- */}
            {!file && scanning && <div className="vault-state">Looking for a {kindLabel(source)} export on this computer…</div>}

            {!file && !scanning && candidates && candidates.length > 0 && (
              <div className="vault-found">
                <div className="vault-hint" style={{ marginBottom: 8 }}>
                  Found {candidates.length === 1 ? "a file that looks like" : "files that look like"} your export — pick one, or choose a different file.
                </div>
                {candidates.map((c) => (
                  <button key={c.path} className="vault-foundrow" onClick={() => previewPath(c.path)}>
                    <span className="vault-foundicon">{c.strong ? "📄" : "❓"}</span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="vault-foundname">{c.name}</span>
                      <span className="vault-foundmeta">
                        {c.dir} · {relTime(c.mtimeMs)} · {kb(c.size)}
                        {!c.strong && " · not sure this is the one"}
                      </span>
                    </span>
                    <span className="vault-foundgo">Use →</span>
                  </button>
                ))}
              </div>
            )}

            {!file && !scanning && candidates && candidates.length === 0 && !isArchive && (
              <div className="vault-hint">
                Nothing found in your Downloads or Desktop yet. Export from {kindLabel(source)} first, then use the button
                above — it will open straight to the right folder.
              </div>
            )}

            {/* How to MAKE the export. The vault cannot press these buttons — every source puts its
                export behind its own sign-in, on purpose — but it can tell you exactly where they are. */}
            {!file && !isArchive && HOWTO[source] && (
              <div className="vault-howto">
                <span className="vault-kind">how to export</span>
                <span>{HOWTO[source]}</span>
              </div>
            )}

            {!file && isArchive && (
              <div className="vault-hint">
                An archive is the encrypted file this vault writes itself. It opens only with the passphrase you chose
                when you exported it — not with your master password, and not on its own.
              </div>
            )}

            {!file && !isArchive && (
              <div className="vault-hint" style={{ marginTop: 10 }}>
                Whichever file you pick, the next step reads its header row and lets you say which column is the site, the
                username and the password — with a preview of exactly what will be created <b>before a single entry is
                written</b>.
              </div>
            )}

            {file && (
              <div className="vault-fileline">
                <span className="vault-kind">file</span>
                <b>{shortFile(file)}</b>
                {preview && <span className="vault-who">{preview.total} rows</span>}
              </div>
            )}

            {busy && !result && <div className="vault-state">Reading the file…</div>}

            {/* ---- the mapping step. This IS the feature: the header row on the left, a column
                    picker on the right, and five real sample rows underneath so you can see what
                    is actually in each column before you commit to it. ---- */}
            {file && !isArchive && preview && mapping && (
              <>
                <div className="vault-maprows">
                  {FIELDS.map(([field, label, required]) => (
                    <div key={field} className="vault-maprow">
                      <label htmlFor={`map-${field}`}>
                        {label}
                        {required && <span className="vault-required"> · required</span>}
                      </label>
                      <select
                        id={`map-${field}`}
                        value={mapping[field]}
                        onChange={(e) => setMapping({ ...mapping, [field]: Number(e.target.value) })}
                      >
                        <option value={-1}>{required ? "— choose a column —" : "— not in this file —"}</option>
                        {preview.headers.map((h, i) => (
                          <option key={`${h}-${i}`} value={i}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="vault-hint" style={{ marginTop: 4 }}>
                  Pre-filled by reading the header row. Check the samples below before importing — an
                  exporter that names its columns unusually is exactly when this guess is wrong.
                </div>

                <div className="vault-samplewrap">
                  <table className="vault-table vault-sample">
                    <thead>
                      <tr>
                        {preview.headers.map((h, i) => {
                          const used = FIELDS.find(([f]) => mapping[f] === i);
                          return (
                            <th key={`${h}-${i}`} className={used ? "on" : ""}>
                              {h || `Column ${i + 1}`}
                              {used && <div className="vault-mapped">→ {used[1]}</div>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((row, r) => (
                        <tr key={r}>
                          {preview.headers.map((_, i) => (
                            <td key={i} className={FIELDS.some(([f]) => mapping[f] === i) ? "on" : ""}>
                              {/* The password column is masked in the PREVIEW. The file is plain text
                                  on disk either way, but there is no reason to paint it on screen. */}
                              {mapping.value === i && row[i] ? "••••••••" : (row[i] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {file && isArchive && (
              <div className="vault-field" style={{ maxWidth: 380, marginTop: 12 }}>
                <label htmlFor="arch-pass">Archive passphrase</label>
                <input
                  id="arch-pass"
                  type="password"
                  value={importPass}
                  autoComplete="off"
                  onChange={(e) => setImportPass(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canImport && !busy) runImport();
                  }}
                />
                <div className="vault-hint">
                  A wrong passphrase and an altered file fail the same way, because the encryption
                  cannot tell them apart. Neither one imports anything.
                </div>
              </div>
            )}

            {error && <div className="vault-state error">{error}</div>}

            {/* ---- what actually happened. A partial import is reported as a partial import: the
                    rows that failed are listed with their row numbers, because "397 of 400" with no
                    detail is a number you cannot act on. ---- */}
            {result && (
              <div className="vault-card" style={{ marginTop: 12, marginBottom: 0, background: "var(--mc-panels)" }}>
                <div className="vault-cardtitle" style={{ color: "var(--vault-strong-color)", marginBottom: 8 }}>
                  {result.created} {result.created === 1 ? "entry" : "entries"} imported
                </div>
                {result.skipped > 0 ? (
                  <>
                    <div className="vault-hint">
                      {result.skipped} {result.skipped === 1 ? "row was" : "rows were"} skipped. Nothing was
                      guessed or half-written — a row either arrived whole or it did not arrive.
                    </div>
                    <ul className="vault-reasons" style={{ marginTop: 8 }}>
                      {result.problems.slice(0, 12).map((p) => (
                        <li key={p.row}>
                          Row {p.row} — {p.reason}
                        </li>
                      ))}
                      {result.problems.length > 12 && <li>…and {result.problems.length - 12} more.</li>}
                    </ul>
                  </>
                ) : (
                  <div className="vault-hint">Every row came across.</div>
                )}
                <div className="vault-hint" style={{ marginTop: 10 }}>
                  <b>Now delete the file you just imported.</b> An exported password file is plain text
                  sitting on your disk, and it stays readable to anything that can read your Downloads
                  folder for as long as you leave it there.
                </div>
              </div>
            )}

            {!result && (
              <div className="vault-btnrow" style={{ marginTop: 12 }}>
                <button className="vault-btn primary" disabled={!canImport || busy} onClick={runImport}>
                  {busy ? "Importing…" : preview ? `Import ${preview.total} rows` : "Import"}
                </button>
                {isArchive && file && importPass.length > 0 && importPass.length < 8 && (
                  <span className="vault-hint" style={{ alignSelf: "center" }}>
                    A passphrase is at least 8 characters.
                  </span>
                )}
              </div>
            )}
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
          <span className="vault-hint">Every export is recorded in the access log</span>
        </div>
        <div className="vault-opts" style={{ gridTemplateColumns: "1fr" }}>
          <label className="vault-opt">
            <input type="radio" name="exp" checked={exportKind === "encrypted"} onChange={() => { setExportKind("encrypted"); setConfirmed(false); setExportMessage(null); }} />
            <span>
              <b>Encrypted archive</b> — restorable only into a vault
            </span>
          </label>
          <label className="vault-opt">
            <input type="radio" name="exp" checked={exportKind === "plain"} onChange={() => { setExportKind("plain"); setConfirmed(false); setExportMessage(null); }} />
            <span>
              <b>Plain CSV</b> — <span style={{ color: "var(--vault-danger-color)" }}>every secret readable by anyone who opens the file</span>
            </span>
          </label>
        </div>

        {exportKind === "encrypted" && (
          <div className="vault-field" style={{ maxWidth: 380, marginTop: 12 }}>
            <label htmlFor="exp-pass">Passphrase for this archive</label>
            <input
              id="exp-pass"
              type="password"
              value={exportPass}
              autoComplete="new-password"
              onChange={(e) => setExportPass(e.target.value)}
            />
            <div className="vault-hint">
              This is <b>not</b> your master password, and it is not stored anywhere — deliberately. It is
              what makes the archive restorable on a different computer, and it is the only thing
              protecting the file. <b>Lose it and the archive is gone.</b> Eight characters minimum.
            </div>
          </div>
        )}

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
          <button
            className={`vault-btn${exportKind === "plain" ? " danger" : " primary"}`}
            disabled={exporting || (exportKind === "plain" ? !confirmed : exportPass.length < 8)}
            onClick={runExport}
          >
            {exporting ? "Writing…" : exportKind === "plain" ? "Export as plain CSV" : "Export encrypted archive"}
          </button>
        </div>
        {exportMessage && <div className="vault-hint" style={{ marginTop: 10 }}>{exportMessage}</div>}
      </div>
    </>
  );
}
