/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// ACTIVITY & ERRORS — its own surface, read like a terminal. Built to
// MOCKUP-vault-errors-and-home-v1-08-12-2026.html §1, approved 08-12-2026.
//
// WHY IT LEFT SETTINGS. It was a card near the bottom, below Storage — and it is the thing you go
// looking for when something has just broken, so it should not need scrolling past three other
// cards to reach. Jason found it so hard to reach he concluded it had never been built.
//
// WHY A TERMINAL AND NOT A TABLE. A log is read by scanning for the odd line, not by comparing
// columns. Fixed-width timestamps and a coloured level in the left gutter let the eye find an ERROR
// in a screen of INFO without reading any of it — which a padded, proportional table actively
// prevents. Colour is never the ONLY signal: the level word is printed beside it.
//
// WHY NOT A SIXTH TAB, even now that the Vault tab has gone: the strip is one row by design and
// tight at the 740 floor, and this surface is empty most days. It is reached from the ⚠ chip in the
// nav row — which appears only when errors exist — and from the sidebar.
//
// LIVE. It polls every three seconds. The log is written MAIN-side by safeHandle, so the renderer
// has no other way to learn that something failed behind it; a refresh button made the user
// responsible for noticing, which is backwards.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import { vaultApi, type VaultLogLevel, type VaultLogRow } from "./vaultApi";

const LEVELS: VaultLogLevel[] = ["error", "warn", "info", "debug"];

/**
 * MM-DD h:mm:ss AM/PM for anything not from today; bare clock time for today, which is most of it.
 *
 * TWELVE-HOUR, NOT MILITARY (Jason 08-12-2026: "the time on the log, needs to not be military time.
 * and should have am/pm to it"). The hour is space-padded rather than zero-padded so the columns
 * still line up — " 7:49:06 PM" and "11:49:06 AM" occupy the same width, which is the only reason
 * the 24-hour form was there in the first place.
 */
function stamp(iso: string, sameDay: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:-- --";
  const p = (n: number): string => String(n).padStart(2, "0");
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12; // midnight and noon are 12, not 0
  const clock = `${String(h12).padStart(2, " ")}:${p(d.getMinutes())}:${p(d.getSeconds())} ${h24 < 12 ? "AM" : "PM"}`;
  return sameDay ? clock : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${clock}`;
}

export default function ErrorsView({ settings, onSetting }: { settings: Record<string, string>; onSetting: (k: string, v: string) => void }) {
  const api = vaultApi();
  const [rows, setRows] = useState<VaultLogRow[] | null>(null);
  // error and warn on by default — the two you actually want to see without asking.
  const [on, setOn] = useState<Set<VaultLogLevel>>(new Set<VaultLogLevel>(["error", "warn"]));
  const [q, setQ] = useState("");
  const [wrap, setWrap] = useState(false);
  const [stacks, setStacks] = useState(true);
  const [copied, setCopied] = useState(false);
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  const load = useCallback((): void => {
    // Always fetch DEBUG-and-up and filter in the renderer: the level toggles then flip instantly
    // instead of costing a round trip each, and the counts stay honest whatever is toggled.
    void api.listEvents({ level: "debug", limit: 500 })
      .then((r) => { setRows(r); setError(null); })
      .catch((e: unknown) => { setRows([]); setError(e instanceof Error ? e.message : String(e)); });
  }, [api]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { error: 0, warn: 0, info: 0, debug: 0 };
    for (const r of rows ?? []) c[r.level] = (c[r.level] ?? 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (!on.has(r.level)) return false;
      if (!needle) return true;
      return `${r.message} ${r.channel ?? ""} ${r.request_id ?? ""} ${r.area}`.toLowerCase().includes(needle);
    });
  }, [rows, on, q]);

  const toggle = (l: VaultLogLevel): void =>
    setOn((p) => { const n = new Set(p); if (n.has(l)) n.delete(l); else n.add(l); return n; });

  /** The whole visible log as plain text — what a support message should carry. */
  const asText = useCallback(
    (): string =>
      shown
        .map((r) => {
          const head = `${new Date(r.ts).toISOString()}  ${r.level.toUpperCase().padEnd(5)}  ${r.channel ?? r.area}  ${r.message}${r.request_id ? `  [${r.request_id}]` : ""}`;
          return r.detail ? `${head}\n${r.detail}` : head;
        })
        .join("\n"),
    [shown]
  );

  const copyAll = (): void => {
    void navigator.clipboard.writeText(asText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }).catch(() => undefined);
  };

  /** Straight to a file the user can attach. A download, not a save dialog — this is plain text
      about the application, never vault contents, so it does not deserve a ceremony. */
  const exportLog = (): void => {
    const blob = new Blob([asText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const p = (n: number): string => String(n).padStart(2, "0");
    a.href = url;
    a.download = `vault-log-${p(d.getMonth() + 1)}-${p(d.getDate())}-${d.getFullYear()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearResolved = (): void => {
    void api.clearLog()
      .then((r) => { setMsg(`${r.removed} routine entries cleared. Errors and warnings were kept.`); load(); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  /**
   * THE DEVELOPER'S CLEAR (Jason 08-12-2026: "i need to be able to delete the errors and warnings
   * for testing"). Gated by a typed word rather than a second OK button — the same shape the
   * organisation reset uses — because the thing being destroyed is the evidence you would need to
   * explain why you destroyed it.
   */
  const [wipe, setWipe] = useState(false);
  const [typed, setTyped] = useState("");
  const clearEverything = (): void => {
    void api.clearAllLog()
      .then((r) => { setMsg(`${r.removed} entries removed — errors and warnings included.`); load(); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const today = new Date().toDateString();
  // A rule between sessions, so "this launch" and "last night" never blur — which is exactly the
  // confusion the stale timestamps caused on 08-12.
  let lastDay = "";

  return (
    <>
      <div className="vault-modeswitch">
        <b style={{ fontSize: 13 }}>Activity &amp; errors</b>
        <span className={`vault-kind${counts.error ? " danger" : ""}`}>{counts.error} errors</span>
        <span className={`vault-kind${counts.warn ? " warn" : ""}`}>{counts.warn} warnings</span>
        <span className="vault-kind">{counts.info} info</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="vault-btn sm" onClick={copyAll}>{copied ? "Copied ✓" : "Copy all"}</button>
          <button className="vault-btn sm" onClick={exportLog}>Export .log</button>
          <button className="vault-btn sm" onClick={() => setAsk(true)}>Clear resolved</button>
          {/* The destructive one is LAST and marked, so the safe clear stays the one your hand
              reaches for. */}
          <button className="vault-btn sm danger" onClick={() => { setTyped(""); setWipe(true); }}>Clear everything</button>
        </span>
      </div>

      {msg && <div className="vault-hint" style={{ marginBottom: 8, color: "var(--vault-strong-color)" }}>{msg}</div>}
      {error && <div className="vault-state error">{error}</div>}

      <div className="vault-termwrap">
        <div className="vault-termbar">
          <span className={`vault-termdot${counts.error ? " hot" : ""}`} aria-hidden="true" />
          {LEVELS.map((l) => (
            <button key={l} className={`vault-tg${on.has(l) ? " on" : ""}`} onClick={() => toggle(l)}>{l}</button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter — paste a VLT- reference, a channel, or any text"
          />
          <button className={`vault-tg${wrap ? " on" : ""}`} onClick={() => setWrap((v) => !v)}>wrap</button>
          <button className={`vault-tg${stacks ? " on" : ""}`} onClick={() => setStacks((v) => !v)}>stacks</button>
          <span className="vault-termlive"><i />live</span>
        </div>

        <div className={`vault-term${wrap ? " wrap" : ""}`} ref={box}>
          {rows === null ? (
            <div className="vault-termempty">reading…</div>
          ) : shown.length === 0 ? (
            <div className="vault-termempty">
              {counts.error + counts.warn + counts.info + counts.debug === 0
                ? "nothing recorded yet — a quiet log is the normal state"
                : "nothing matches the current filters"}
            </div>
          ) : (
            shown.map((r) => {
              const day = new Date(r.ts).toDateString();
              const newSession = lastDay !== "" && day !== lastDay;
              lastDay = day;
              return (
                <div key={r.uuid}>
                  <div className={`vault-tln${newSession ? " grp" : ""}`}>
                    <span className="ts">{stamp(r.ts, day === today)}</span>
                    <span className={`lv ${r.level}`}>{r.level.toUpperCase()}</span>
                    <span className="ch">{r.channel ?? r.area}</span>
                    <span className="msg">{r.message}</span>
                    {r.request_id && <span className="ref">{r.request_id}</span>}
                  </div>
                  {stacks && r.detail && <div className="vault-tstack">{r.detail}</div>}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="vault-termfoot">
        <span className="vault-hint">
          Newest first · a rule separates sessions · <b>live</b> means it appends as things happen, no refresh button.
          When something breaks you are shown a plain sentence and a short reference like <code>VLT-A3F91C</code> —
          paste it above to find the technical detail behind it.
        </span>
        <span className="vault-recfrom">
          <label htmlFor="log-min">Record from now on</label>
          <select id="log-min" value={(settings["log.min_level"] as VaultLogLevel) ?? "info"}
            onChange={(e) => onSetting("log.min_level", e.target.value)}>
            <option value="error">Errors only</option>
            <option value="warn">Warnings and errors</option>
            <option value="info">Normal operation</option>
            <option value="debug">Everything, including developer detail</option>
          </select>
        </span>
      </div>
      <div className="vault-hint" style={{ marginTop: 6 }}>
        That changes what is <b>written from now on</b>, not what is shown above — it cannot fill in detail for
        something that already happened. Turn it up before reproducing a problem you want traced.
      </div>

      {ask && (
        <ConfirmModal
          title="Clear the routine entries?"
          body={
            <>
              <p>Removes <b>info</b> and <b>debug</b> lines — the ordinary running commentary.</p>
              <p><b>Errors and warnings are kept.</b> Those are evidence, and a log you can quietly empty of its
                failures is worth less than one you cannot.</p>
            </>
          }
          confirmLabel="Clear routine entries"
          danger
          onConfirm={clearResolved}
          onClose={() => setAsk(false)}
        />
      )}

      {wipe && (
        <ConfirmModal
          title="Empty the whole log?"
          body={
            <>
              <p>
                Removes <b>every</b> entry — {counts.error} error{counts.error === 1 ? "" : "s"} and{" "}
                {counts.warn} warning{counts.warn === 1 ? "" : "s"} included, not just the routine lines.
              </p>
              <p>
                <b>That cannot be undone</b>, and it is the evidence you would use to explain a failure
                after the fact. Export the log first if there is any chance you will want it.
              </p>
              <p className="vault-hint">
                One line is written afterwards recording that this happened — an empty log that cannot
                account for its own emptiness is worse than a short one.
              </p>
              <div className="vault-field" style={{ marginTop: 10 }}>
                <label htmlFor="wipe-confirm">Type <b>EMPTY</b> — capitals — to confirm</label>
                <input id="wipe-confirm" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="EMPTY" />
              </div>
            </>
          }
          confirmLabel={typed.trim() === "EMPTY" ? "Empty the log" : "Type EMPTY first"}
          danger
          /**
           * CASE-SENSITIVE, and it is not pedantry (Jason 08-12-2026: "it should be case sensitive").
           * The whole point of a typed confirmation is to cost a deliberate moment; accepting "empty"
           * makes it a word you can fire off without looking, which is the state of mind this gate
           * exists to interrupt. Surrounding spaces are still forgiven — those are a keyboard, not a
           * decision.
           */
          blocked={typed.trim() === "EMPTY" ? null : "Type EMPTY in capital letters in the box above, then press this again. Cancel is the only thing that closes this dialog."}
          onConfirm={clearEverything}
          onClose={() => { setWipe(false); setTyped(""); }}
        />
      )}
    </>
  );
}
