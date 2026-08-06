/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Generator (mockup surface 5), Health (surface 6) and the Access log — the three tool surfaces.
// The generator computes main-side so one estimator has one home; health returns VERDICTS only, so
// the analysis can look at every password without a single one crossing the bridge; the access log
// is safe by construction because its table has no value column to select.
import { useCallback, useEffect, useState } from "react";
import { vaultApi, type VaultAccessRow, type VaultGeneratorOptions, type VaultHealthReport, type VaultStrength } from "./vaultApi";
import { shortDate } from "./SecretsView";

// ---------------------------------------------------------------- generator
export function GeneratorView({ settings, onSetting }: { settings: Record<string, string>; onSetting: (k: string, v: string) => void }) {
  const api = vaultApi();
  const [opts, setOpts] = useState<VaultGeneratorOptions>({
    length: Number(settings["generator.length"] ?? 16),
    lowercase: settings["generator.lowercase"] !== "0",
    uppercase: settings["generator.uppercase"] !== "0",
    numbers: settings["generator.numbers"] !== "0",
    symbols: settings["generator.symbols"] !== "0",
    excludeSimilar: settings["generator.exclude_similar"] === "1",
    excludeAmbiguous: settings["generator.exclude_ambiguous"] === "1",
    noRepeats: settings["generator.no_repeats"] === "1",
  });
  const [value, setValue] = useState("");
  const [strength, setStrength] = useState<VaultStrength | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const regenerate = useCallback(
    (o: VaultGeneratorOptions): void => {
      setError(null);
      setCopied(false);
      void api
        .generate(o)
        .then((p) => {
          setValue(p);
          return api.strength(p).then(setStrength);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
          setValue("");
          setStrength(null);
        });
    },
    [api]
  );

  useEffect(() => {
    regenerate(opts);
  }, [regenerate]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every change regenerates AND persists the preference — view state lives in the database. */
  const change = <K extends keyof VaultGeneratorOptions>(k: K, v: VaultGeneratorOptions[K], settingKey: string): void => {
    const next = { ...opts, [k]: v };
    setOpts(next);
    regenerate(next);
    onSetting(settingKey, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  };

  const TOGGLES: [keyof VaultGeneratorOptions, string, string][] = [
    ["lowercase", "Lowercase", "generator.lowercase"],
    ["uppercase", "Uppercase", "generator.uppercase"],
    ["numbers", "Numbers", "generator.numbers"],
    ["symbols", "Symbols", "generator.symbols"],
    ["excludeSimilar", "Exclude similar looking (o 0 i l 1)", "generator.exclude_similar"],
    ["excludeAmbiguous", "Exclude awkward symbols", "generator.exclude_ambiguous"],
    ["noRepeats", "No repeated characters", "generator.no_repeats"],
  ];

  return (
    <div className="vault-card">
      <div className="vault-cardhead">
        <span className="vault-cardtitle">Password generator</span>
      </div>
      <div className="vault-genout">
        <span className="value">{value || "—"}</span>
        <button className="vault-btn" onClick={() => regenerate(opts)}>
          Regenerate
        </button>
        <button
          className="vault-btn primary"
          disabled={!value}
          onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {error && <div className="vault-state error">{error}</div>}
      {strength && (
        <>
          <div className="vault-meter">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} className={i <= strength.level ? (strength.level <= 1 ? "bad" : strength.level === 2 ? "warn" : "on") : ""} />
            ))}
          </div>
          <div className="vault-strengthrow">
            <span style={{ fontWeight: 600 }}>{strength.label}</span>
            <span className="vault-hint">
              About {strength.crackTime} to crack · {strength.bits} bits — a rough guide, not a promise.
            </span>
          </div>
        </>
      )}
      <div className="vault-opts">
        <div className="vault-opt">
          <span style={{ minWidth: 62 }}>Length {opts.length}</span>
          <input
            type="range"
            min={8}
            max={64}
            value={opts.length}
            onChange={(e) => change("length", Number(e.target.value), "generator.length")}
          />
        </div>
        {TOGGLES.map(([key, label, settingKey]) => (
          <label key={key} className="vault-opt">
            <input type="checkbox" checked={Boolean(opts[key])} onChange={(e) => change(key, e.target.checked as never, settingKey)} />
            {label}
          </label>
        ))}
      </div>
      <div className="vault-hint" style={{ marginTop: 14 }}>
        Generated on this machine. Nothing is sent anywhere, online or off.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- health
export function HealthView() {
  const api = vaultApi();
  const [report, setReport] = useState<VaultHealthReport | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback((): void => {
    setError(false);
    setReport(null);
    void api.health().then(setReport).catch(() => setError(true));
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="vault-state error">
        The health check could not run.
        <div>
          <button className="vault-btn" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!report) return <div className="vault-state">Checking every entry on this machine…</div>;
  if (report.total === 0) return <div className="vault-state">There is nothing stored to check yet.</div>;

  return (
    <>
      <div className="vault-hgrid">
        <div className="vault-hcard">
          <span className="vault-hlabel">Overall</span>
          <span className="vault-hvalue">{report.score}</span>
        </div>
        <div className="vault-hcard">
          <span className="vault-hlabel">Healthy</span>
          <span className="vault-hvalue" style={{ color: "var(--vault-strong-color)" }}>{report.healthy}</span>
        </div>
        <div className="vault-hcard">
          <span className="vault-hlabel">Weak</span>
          <span className="vault-hvalue" style={{ color: "var(--vault-danger-color)" }}>{report.weak}</span>
        </div>
        <div className="vault-hcard">
          <span className="vault-hlabel">Reused</span>
          <span className="vault-hvalue" style={{ color: "var(--vault-warn-color)" }}>{report.reused}</span>
        </div>
        <div className="vault-hcard">
          <span className="vault-hlabel">Older than 90 days</span>
          <span className="vault-hvalue" style={{ color: "var(--vault-warn-color)" }}>{report.stale}</span>
        </div>
      </div>
      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Worst first</span>
          <button className="vault-btn" onClick={load}>
            Re-check
          </button>
        </div>
        <table className="vault-table">
          <thead>
            <tr>
              <th>Entry</th>
              <th style={{ width: 60 }}>Score</th>
              <th>What to do</th>
            </tr>
          </thead>
          <tbody>
            {report.items.map((i) => (
              <tr key={i.uuid}>
                <td>
                  <b>{i.label}</b>
                  {i.username && <div className="vault-who">{i.username}</div>}
                </td>
                <td>
                  <span
                    className="vault-score"
                    style={{ color: i.score >= 70 ? "var(--vault-strong-color)" : i.score >= 40 ? "var(--vault-warn-color)" : "var(--vault-danger-color)" }}
                  >
                    {i.score}
                  </span>
                </td>
                <td>
                  <ul className="vault-reasons">
                    {i.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="vault-hint" style={{ marginTop: 12 }}>
          Every entry was checked on this machine. No password left the vault to produce this — only the verdicts above.
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- access log
export function AccessLogView() {
  const api = vaultApi();
  const [rows, setRows] = useState<VaultAccessRow[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback((): void => {
    setError(false);
    setRows(null);
    void api.listAccessLog({ limit: 500 }).then(setRows).catch(() => setError(true));
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="vault-state error">
        The access log could not be read.
        <div>
          <button className="vault-btn" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!rows) return <div className="vault-state">Reading the access log…</div>;

  return (
    <div className="vault-card">
      <div className="vault-cardhead">
        <span className="vault-cardtitle">Access log</span>
        <span className="vault-hint">Every read, change and refusal — permanently</span>
      </div>
      {rows.length === 0 ? (
        <div className="vault-state">Nothing has happened in this vault yet.</div>
      ) : (
        <table className="vault-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Entry</th>
              <th>Who asked</th>
              <th>Action</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="vault-mono">{shortDate(r.ts)}</td>
                <td>{r.secret_label ?? <span className="vault-who">—</span>}</td>
                <td className="vault-who">{r.caller}</td>
                <td>{r.action.replace(/_/g, " ")}</td>
                <td style={{ color: r.granted === 1 ? "var(--vault-strong-color)" : "var(--vault-danger-color)" }}>
                  {r.granted === 1 ? "Granted" : `Refused${r.detail ? ` — ${r.detail}` : ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
