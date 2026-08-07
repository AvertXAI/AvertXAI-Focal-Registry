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
export function HealthView({ settings, onSetting }: { settings: Record<string, string>; onSetting: (k: string, v: string) => void }) {
  const api = vaultApi();
  const [report, setReport] = useState<VaultHealthReport | null>(null);
  const [error, setError] = useState(false);
  // ---- dark-web exposure. Separate state from the local health report on purpose: one is a
  // computation on this machine, the other left the building, and the screen must not blur that.
  const [breach, setBreach] = useState<{ checked: number; exposed: { uuid: string; label: string; site: string | null; count: number | null }[] } | null>(null);
  const [breachError, setBreachError] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [email, setEmail] = useState("");
  const [emailResult, setEmailResult] = useState<{ exposed: boolean; breaches: string[] } | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const breachOn = settings["breach.enabled"] === "1";

  // Polled while the sweep runs — 46 entries at the service's own rate limit is roughly half a
  // minute, and a button that just says "Checking…" for that long reads as a frozen application.
  const [progress, setProgress] = useState<{ done: number; total: number; found: number } | null>(null);
  useEffect(() => {
    if (!sweeping) return;
    const timer = setInterval(() => {
      void api
        .breachProgress()
        .then((p) => setProgress({ done: p.done, total: p.total, found: p.found }))
        .catch(() => undefined);
    }, 500);
    return () => clearInterval(timer);
  }, [api, sweeping]);

  // ---- "now what": one press generates a strong replacement, SUPERSEDES the entry (the old value
  // is kept, as always), and copies the new one ready to paste into the site. The vault cannot
  // change a password on a website — nothing can — so the honest job is to make the human's next
  // two minutes as short as possible.
  const [fixMessage, setFixMessage] = useState<string | null>(null);
  const onFixEntry = useCallback(
    async (uuid: string, label: string): Promise<void> => {
      setFixMessage(null);
      try {
        const fresh = await api.generate({ length: 20 });
        await api.supersede(uuid, fresh);
        await navigator.clipboard.writeText(fresh);
        setFixMessage(`New password saved for ${label} and copied — paste it on the site to finish. The old one is kept in its history.`);
      } catch (e) {
        setFixMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [api]
  );
  const openSite = useCallback(async (site: string): Promise<void> => {
    // The vault never navigates anywhere itself; this hands the address to the system browser.
    window.open(site.startsWith("http") ? site : `https://${site}`, "_blank", "noopener");
  }, []);

  const sweep = useCallback((): void => {
    setSweeping(true);
    setBreachError(null);
    setBreach(null);
    setProgress({ done: 0, total: 0, found: 0 });
    void api
      .breachSweep()
      .then((r) => (r.ok ? setBreach({ checked: r.checked, exposed: r.exposed }) : setBreachError(r.error ?? "The check could not run.")))
      .catch((e: unknown) => setBreachError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setSweeping(false);
        setProgress(null);
      });
  }, [api]);

  const checkEmail = useCallback((): void => {
    setEmailBusy(true);
    setEmailError(null);
    setEmailResult(null);
    void api
      .breachEmail(email)
      .then((r) => (r.ok ? setEmailResult({ exposed: r.exposed, breaches: r.breaches }) : setEmailError(r.error ?? "The check could not run.")))
      .catch((e: unknown) => setEmailError(e instanceof Error ? e.message : String(e)))
      .finally(() => setEmailBusy(false));
  }, [api, email]);

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
      {/* ---- dark web. Its own card, above the local scoring, because it is the only thing here
              that leaves the machine and the user should never be unsure which is which. ---- */}
      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Dark web</span>
          <label className="vault-opt" style={{ margin: 0 }}>
            <input type="checkbox" checked={breachOn} onChange={(e) => onSetting("breach.enabled", e.target.checked ? "1" : "0")} />
            Allow checks over the internet
          </label>
        </div>
        {!breachOn ? (
          <div className="vault-hint">
            Everything else in this vault happens on your computer. These two checks are the only ones that talk to the
            internet, so they stay off until you switch them on.
          </div>
        ) : (
          <>
            <div className="vault-hint">
              <b>Passwords.</b> Your password is scrambled here and only the first ten characters of the result are sent —
              enough to ask "has anything like this been leaked?", never enough for anyone to work out what it was. Safe
              to run across every entry.
            </div>
            <div className="vault-btnrow" style={{ marginTop: 10, alignItems: "center" }}>
              <button className="vault-btn primary" disabled={sweeping} onClick={sweep}>
                {sweeping ? "Checking…" : "Check every password"}
              </button>
              {sweeping && progress && (
                <span style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 200 }}>
                  <span className="vault-spinner" aria-hidden="true" />
                  <span className="vault-progbar">
                    <i style={{ width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : "4%" }} />
                  </span>
                  <span className="vault-mono vault-who" style={{ whiteSpace: "nowrap" }}>
                    {progress.total ? `${progress.done} of ${progress.total}` : "starting…"}
                    {progress.found > 0 ? ` · ${progress.found} found` : ""}
                  </span>
                </span>
              )}
            </div>
            {sweeping && (
              <div className="vault-hint" style={{ marginTop: 8 }}>
                Each password is checked one at a time on purpose — the service allows two a second, and going faster
                would get us turned away. About half a minute for a full vault.
              </div>
            )}
            {breachError && <div className="vault-state error">{breachError}</div>}
            {breach && (
              <div style={{ marginTop: 12 }}>
                {breach.exposed.length === 0 ? (
                  <div className="vault-hint" style={{ color: "var(--vault-strong-color)" }}>
                    {breach.checked} passwords checked — none of them turned up in a known leak.
                  </div>
                ) : (
                  <>
                    {/* The answer to "now what". A list of problems with no next step is just
                        anxiety; each row gets the one action that fixes it, in place. */}
                    <div className="vault-hint" style={{ marginBottom: 10 }}>
                      <b>What this means.</b> These exact passwords appear in leaked data that anyone can download. It
                      does not mean these accounts were broken into — it means the password is on a list attackers try
                      first. <b>Change each one, starting at the top.</b>
                    </div>
                    <table className="vault-table">
                      <thead>
                        <tr>
                          <th>Found in a leak</th>
                          <th>Times seen</th>
                          <th>Fix it</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breach.exposed.map((x) => (
                          <tr key={x.uuid}>
                            <td>
                              <b>{x.label}</b>
                            </td>
                            <td className="vault-mono" style={{ color: "var(--vault-danger-color)" }}>
                              {x.count?.toLocaleString() ?? "—"}
                            </td>
                            <td>
                              <div className="vault-acts" style={{ justifyContent: "flex-start" }}>
                                <button
                                  className="vault-btn"
                                  title="Make a strong replacement and copy it, ready to paste into the site"
                                  onClick={() => void onFixEntry(x.uuid, x.label)}
                                >
                                  New password → clipboard
                                </button>
                                {x.site && (
                                  <button className="vault-btn" onClick={() => void openSite(x.site!)}>
                                    Open {x.site}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {fixMessage && (
                      <div className="vault-hint" style={{ marginTop: 10, color: "var(--vault-strong-color)" }}>
                        {fixMessage}
                      </div>
                    )}
                    <div className="vault-hint" style={{ marginTop: 10 }}>
                      The button generates a strong password, saves it here as a new version (the old one is kept), and
                      puts it on your clipboard. Then change it on the site itself and paste — <b>a password manager
                      cannot change it for you</b>, only remember the new one.
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="vault-hint" style={{ marginTop: 18 }}>
              <b>Email addresses.</b> This one is different and you should know it: the address is sent as you typed it,
              because that is the only way this check works. One address at a time, only when you press the button.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="paul@example.com"
                style={{ flex: 1, minWidth: 200, background: "var(--mc-field)", border: "1px solid var(--mc-border)", borderRadius: 8, padding: "9px 11px", color: "var(--mc-text)", fontSize: 12.5 }}
              />
              <button className="vault-btn" disabled={emailBusy || !email.includes("@")} onClick={checkEmail}>
                {emailBusy ? "Checking…" : "Check this address"}
              </button>
            </div>
            {emailError && <div className="vault-state error">{emailError}</div>}
            {emailResult && (
              <div className="vault-hint" style={{ marginTop: 10 }}>
                {emailResult.exposed ? (
                  <>
                    <span style={{ color: "var(--vault-danger-color)", fontWeight: 600 }}>
                      Found in {emailResult.breaches.length} known {emailResult.breaches.length === 1 ? "breach" : "breaches"}.
                    </span>{" "}
                    {emailResult.breaches.slice(0, 20).join(", ")}
                    {emailResult.breaches.length > 20 ? ` and ${emailResult.breaches.length - 20} more.` : ""}
                    {/* The answer to "now what". Being told you are in a breach and nothing else is
                        useless — this is the actual, ordered list of what a person can do. */}
                    <div style={{ marginTop: 10, color: "var(--mc-text)" }}>
                      <b>What to do about it — in this order:</b>
                      <ol className="vault-reasons" style={{ listStyle: "decimal", marginTop: 6 }}>
                        <li>
                          <b>Do not change your email address.</b> A breach list is public and permanent; a new address
                          does not remove you from it and costs you every account tied to the old one. This is almost
                          never the right move.
                        </li>
                        <li>
                          <b>Run the password check above.</b> It is the one that actually matters. A leaked address is
                          only dangerous when the password beside it still works somewhere.
                        </li>
                        <li>
                          <b>Change any password you reused</b>, starting with email, banking, and anything holding a
                          card. The Health list below is already sorted worst-first.
                        </li>
                        <li>
                          <b>Turn on two-step sign-in</b> for the accounts named above. It is what makes a leaked
                          password stop being enough on its own.
                        </li>
                        <li>
                          <b>Expect more spam and better-aimed scams.</b> Anyone quoting one of those company names at
                          you now may simply have bought the list — treat unexpected contact from them as unproven.
                        </li>
                      </ol>
                    </div>
                  </>
                ) : (
                  <span style={{ color: "var(--vault-strong-color)" }}>Not found in any known breach.</span>
                )}
              </div>
            )}
          </>
        )}
      </div>

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
