/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The package ledger — MOVED OUT OF REPOS onto the Infrastructure tab (Jason 08-11-2026), sitting
// between SSH keys and Import records.
//
// WHY IT BELONGS HERE AND NOT WITH REPOS. It reads the same way as the rest of Infrastructure: an
// inventory of what this machine is standing on, with a verdict attached. Repos answers "what did
// we build"; this answers "what did we agree to when we did" — the same shape of question a server
// row or an SSH key answers about a machine. It also never touches a repository record (it walks
// the installed tree), so sharing a tab with Repos only ever meant sharing a segment control.
//
// The ledger is not a list, it is a RULING: §2.10 names the permissive licences and the ones that
// stop the line, so green needs nothing from you, red is already decided, and amber is the only
// column that is actually an inbox.
//
// NO NETWORK, by construction. Every column is read off this machine — package.json and the
// lockfile for name and version, each installed package's own manifest for the declared licence,
// and a folder walk for the size. Nothing here asks the registry anything.
import { useCallback, useEffect, useState } from "react";
import Loading from "./Loading";
import { vaultApi, type VaultPackageRow } from "./vaultApi";

export default function PackageLedger() {
  const api = vaultApi();
  const [data, setData] = useState<{ packages: VaultPackageRow[]; totalMb: number } | null>(null);
  const [filter, setFilter] = useState<"all" | "needs_ruling" | "banned">("all");
  const [error, setError] = useState(false);
  const load = useCallback((): void => { setError(false); void api.scanPackages().then(setData).catch(() => setError(true)); }, [api]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="vault-state error">The package tree could not be read.<div><button className="vault-btn" onClick={load}>Try again</button></div></div>;
  if (!data) return <Loading message="Reading the installed tree…" />;

  const counts = {
    all: data.packages.length,
    approved: data.packages.filter((p) => p.verdict === "approved").length,
    banned: data.packages.filter((p) => p.verdict === "banned").length,
    ruling: data.packages.filter((p) => p.verdict === "needs_ruling").length,
    big: data.packages.filter((p) => p.sizeMb > 20).length,
  };
  const rows = data.packages.filter((p) => filter === "all" || p.verdict === filter);

  return (
    <>
      <div className="vault-chips">
        <div className="vault-chip-stat"><span className="k">Tracked</span><span className="v">{counts.all}</span></div>
        <div className="vault-chip-stat"><span className="k">Approved</span><span className="v" style={{ color: "var(--vault-strong-color)" }}>{counts.approved}</span></div>
        <div className="vault-chip-stat"><span className="k">Banned</span><span className="v" style={{ color: "var(--vault-danger-color)" }}>{counts.banned}</span></div>
        <div className="vault-chip-stat"><span className="k">Needs ruling</span><span className="v" style={{ color: "var(--vault-warn-color)" }}>{counts.ruling}</span></div>
        <div className="vault-chip-stat"><span className="k">Over 20 MB</span><span className="v" style={{ color: "var(--vault-warn-color)" }}>{counts.big}</span></div>
        <div className="vault-chip-stat"><span className="k">Install size</span><span className="v" style={{ fontSize: 15 }}>{data.totalMb} MB</span></div>
      </div>
      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Package ledger</span>
          <div className="vault-btnrow">
            <div className="vault-seg">
              <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All {counts.all}</button>
              <button className={filter === "needs_ruling" ? "on" : ""} onClick={() => setFilter("needs_ruling")}>Needs ruling {counts.ruling}</button>
              <button className={filter === "banned" ? "on" : ""} onClick={() => setFilter("banned")}>Banned {counts.banned}</button>
            </div>
            <button className="vault-btn" onClick={load}>Rescan</button>
          </div>
        </div>
        <div className="vault-tscroll">
          <table className="vault-table">
            <thead><tr><th>Package</th><th style={{ width: 78 }}>Version</th><th style={{ width: 96 }}>Licence</th><th style={{ width: 70 }}>Size</th><th style={{ width: 112 }}>Verdict</th><th>Why</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.name} className={p.verdict === "approved" ? undefined : "nb"}>
                  <td><b>{p.name}</b></td>
                  <td className="vault-mono">{p.version}</td>
                  <td className="vault-mono">{p.license}</td>
                  <td className="vault-mono">{p.sizeMb ? `${p.sizeMb} MB` : "—"}</td>
                  <td>
                    <span className={`vault-kind${p.verdict === "banned" ? " danger" : p.verdict === "needs_ruling" ? " warn" : " ok"}`}>
                      {p.verdict === "needs_ruling" ? "needs ruling" : p.verdict}
                    </span>
                  </td>
                  <td className="vault-who">{p.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="vault-hint" style={{ marginTop: 12 }}>
          Ruled automatically from the licence field using the §2.10 lists — permissive passes without asking, copyleft
          and source-available stop the line, and anything undeterminable lands in <b>Needs ruling</b>, which is the only
          column that is your inbox. Sizes come from the installed tree (§2.11's 20 MB threshold is flagged in place).
        </div>
      </div>
    </>
  );
}
