/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// THE generator — six modes and every option, in ONE component. It renders in two places: its own
// tab, and inside the entry form. It lives in its own file rather than in ToolsViews because
// EntriesView needs it and ToolsViews already imports from EntriesView — a cycle nobody wants to
// debug at boot.
//
// `onUse` is the ONLY difference between the two placements: present means "you are filling in a
// value", so the panel offers to hand the result over instead of only to the clipboard. Everything
// else — the modes, the toggles, the meter, the persisted preferences — is the same code, so the
// form can never drift into being a second, weaker generator.
import { useCallback, useEffect, useState } from "react";
import { vaultApi, type VaultGeneratorOptions, type VaultStrength } from "./vaultApi";

/** The mockup's six tabs. Each produces a different KIND of secret. */
type GenMode = "random" | "advanced" | "memorable" | "passphrase" | "pin" | "bulk";
const MODES: [GenMode, string][] = [
  ["random", "Strong / random"],
  ["advanced", "Advanced"],
  ["memorable", "Memorable"],
  ["passphrase", "Passphrase"],
  ["pin", "PIN code"],
  ["bulk", "Bulk"],
];

/**
 * LABEL, then the long explanation as a TITLE (Jason 08-13-2026: "the options are truncated").
 *
 * "Exclude similar looking (o 0 i l 1)" is three times the width of "Lowercase", and this panel is
 * rendered INSIDE the new-entry modal as well as full width on its own tab. In the modal the grid
 * has roughly 180 pixels a column, so the long ones wrapped onto two and three lines and the row
 * stopped reading as a list of checkboxes. Short label on screen, full sentence on hover — nothing
 * is lost, and the ones that matter are the four everybody actually toggles.
 */
const TOGGLES: [keyof VaultGeneratorOptions, string, string, string][] = [
  ["lowercase", "Lowercase", "generator.lowercase", "Include a–z"],
  ["uppercase", "Uppercase", "generator.uppercase", "Include A–Z"],
  ["numbers", "Numbers", "generator.numbers", "Include 0–9"],
  ["symbols", "Symbols", "generator.symbols", "Include punctuation"],
  ["excludeSimilar", "No look-alikes", "generator.exclude_similar", "Leave out characters that are easy to confuse when read aloud or retyped: o 0 i l 1"],
  ["excludeAmbiguous", "No awkward symbols", "generator.exclude_ambiguous", "Leave out symbols that break shells, spreadsheets and command lines"],
  ["noRepeats", "No repeats", "generator.no_repeats", "Never use the same character twice — shortens the real key space, so it costs strength"],
];

export interface GeneratorPanelProps {
  settings: Record<string, string>;
  onSetting: (k: string, v: string) => void;
  /** Present inside the entry form: adds "Use this" and makes each bulk result pickable. */
  onUse?: (value: string) => void;
}

export default function GeneratorPanel({ settings, onSetting, onUse }: GeneratorPanelProps) {
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

  const [mode, setMode] = useState<GenMode>("random");
  const [words, setWords] = useState(5);
  const [pinDigits, setPinDigits] = useState(6);
  const [bulkCount, setBulkCount] = useState(10);
  const [bulk, setBulk] = useState<string[]>([]);

  const regenerate = useCallback(
    (o: VaultGeneratorOptions, m: GenMode = mode): void => {
      setError(null);
      setCopied(false);
      setBulk([]);
      const produce = (): Promise<string | string[]> => {
        switch (m) {
          case "passphrase":
            return api.generatePassphrase({ words, separator: "-", capitalise: true, includeNumber: true });
          case "memorable":
            return api.generateMemorable(o.length);
          case "pin":
            return api.generatePin(pinDigits);
          case "bulk":
            return api.generateBulk(bulkCount, o);
          default:
            // "Advanced" is the same engine with every control exposed — the difference is what the
            // screen offers, not what it computes, so it deliberately shares this path.
            return api.generate(o);
        }
      };
      void produce()
        .then((p) => {
          if (Array.isArray(p)) {
            setBulk(p);
            setValue("");
            setStrength(null);
            return;
          }
          setValue(p);
          // The meter scores what was ACTUALLY produced. A memorable password or a PIN scores badly
          // next to a random one of the same length, and it should — that is the honest trade.
          return api.strength(p).then(setStrength);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
          setValue("");
          setStrength(null);
        });
    },
    [api, mode, words, pinDigits, bulkCount]
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

  return (
    <>
      <div className="vault-viewsw" style={{ marginBottom: 14 }}>
        {MODES.map(([m, label]) => (
          <button
            key={m}
            type="button"
            className={`vault-swbtn${mode === m ? " on" : ""}`}
            onClick={() => {
              setMode(m);
              regenerate(opts, m);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="vault-genout">
        <span className="value">{value || "—"}</span>
        <button type="button" className="vault-btn" onClick={() => regenerate(opts)}>
          Regenerate
        </button>
        <button
          type="button"
          className={onUse ? "vault-btn" : "vault-btn primary"}
          disabled={!value}
          onClick={() => void api.copyText(value).then(() => setCopied(true))}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {onUse && (
          <button type="button" className="vault-btn primary" disabled={!value} onClick={() => onUse(value)}>
            Use this
          </button>
        )}
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
      {/* Bulk prints a list rather than one value — copying all of them at once is the point. In
          the entry form each one is instead a button, because there the job is to pick one. */}
      {bulk.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="vault-btnrow" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className="vault-btn"
              onClick={() => void api.copyText(bulk.join("\n")).then(() => setCopied(true))}
            >
              {copied ? "Copied all" : `Copy all ${bulk.length}`}
            </button>
          </div>
          <div className="vault-bulklist">
            {bulk.map((p, i) =>
              onUse ? (
                <button key={`${p}-${i}`} type="button" className="vault-bulkpick" title="Use this one" onClick={() => onUse(p)}>
                  {p}
                </button>
              ) : (
                <code key={`${p}-${i}`}>{p}</code>
              )
            )}
          </div>
        </div>
      )}

      {/* Each mode shows only the controls that mean anything to it. */}
      <div className="vault-opts">
        {mode === "passphrase" ? (
          <div className="vault-opt">
            <span style={{ minWidth: 92 }}>Words {words}</span>
            <input type="range" min={3} max={10} value={words} onChange={(e) => { setWords(Number(e.target.value)); }} onMouseUp={() => regenerate(opts)} onKeyUp={() => regenerate(opts)} />
          </div>
        ) : mode === "pin" ? (
          <div className="vault-opt">
            <span style={{ minWidth: 92 }}>Digits {pinDigits}</span>
            <input type="range" min={3} max={12} value={pinDigits} onChange={(e) => { setPinDigits(Number(e.target.value)); }} onMouseUp={() => regenerate(opts)} onKeyUp={() => regenerate(opts)} />
          </div>
        ) : (
          <>
            <div className="vault-opt">
              <span style={{ minWidth: 92 }}>Length {opts.length}</span>
              <input
                type="range"
                min={8}
                max={64}
                value={opts.length}
                onChange={(e) => change("length", Number(e.target.value), "generator.length")}
              />
            </div>
            {mode === "bulk" && (
              <div className="vault-opt">
                <span style={{ minWidth: 92 }}>How many {bulkCount}</span>
                <input type="range" min={2} max={100} value={bulkCount} onChange={(e) => { setBulkCount(Number(e.target.value)); }} onMouseUp={() => regenerate(opts)} onKeyUp={() => regenerate(opts)} />
              </div>
            )}
            {/* "Memorable" builds from syllables, so the character toggles do not apply to it. */}
            {mode !== "memorable" &&
              TOGGLES.map(([key, label, settingKey, why]) => (
                <label key={key} className="vault-opt" title={why}>
                  <input type="checkbox" checked={Boolean(opts[key])} onChange={(e) => change(key, e.target.checked as never, settingKey)} />
                  <span>{label}</span>
                </label>
              ))}
          </>
        )}
      </div>
      {mode === "memorable" && (
        <div className="vault-hint" style={{ marginTop: 10 }}>
          Built from syllables so you can read it down a phone. It is <b>weaker than a random one of the same
          length</b> — the meter above scores what it really is, not what its length suggests.
        </div>
      )}
      {mode === "passphrase" && (
        <div className="vault-hint" style={{ marginTop: 10 }}>
          Words are easier to type and remember than symbols, and length does the work. Five words from a
          256-word list is about 40 bits before the capital and the digit.
        </div>
      )}
      {mode === "pin" && (
        <div className="vault-hint" style={{ marginTop: 10 }}>
          A PIN is short by nature — this is for a phone or a bank card, not for a website login.
        </div>
      )}
      <div className="vault-hint" style={{ marginTop: 14 }}>
        Generated on this machine. Nothing is sent anywhere, online or off.
      </div>
    </>
  );
}
