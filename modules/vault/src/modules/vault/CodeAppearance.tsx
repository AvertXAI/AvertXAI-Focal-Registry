/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Settings · Code appearance. Approved mockup: docs/MOCKUP-vault-code-appearance-v1-08-12-2026.html.
//
// Jason, on being shown coloured code blocks with no way to change them: "where do i select my
// colors?" This is that surface. Its own file rather than another 200 lines inside
// VaultSettingsView, following SidebarEditor's precedent.
//
// ONE THEME PER MODE, and that is the whole reason there are two dropdowns rather than one. Which
// palette applies is decided by the SHELL's light/dark state, not by a vault preference — §3.3 —
// so a single choice would be unreadable in one of the two modes. VaultModule reads whichever one
// matches and writes it out as --vault-code-* variables.
//
// NOTHING THIRD-PARTY SHIPS. The two built-ins are ours. Any other theme is READ from the user's own
// machine: the main process lists what Visual Studio Code has installed, hands back the raw file,
// and codeTheme.ts maps it. Bundling somebody's theme would be redistributing their work inside a
// commercial product for no gain, since the file is already on disk — and it would go stale the
// moment they installed a different one.
//
// THE PREVIEW IS THE REAL RENDERER. CodeSample is the same component the notes pane paints fences
// with, reading the same variables. A preview drawn by different code is a preview that can lie
// about what you are choosing.
import { useCallback, useEffect, useMemo, useState } from "react";
import { CodeSample } from "./markdown";
import {
  BUILT_IN, DEFAULT_DARK, DEFAULT_LIGHT, importVsCodeTheme, readTheme, type CodeTheme, type Role,
} from "./codeTheme";
import { vaultApi, type VaultFoundTheme } from "./vaultApi";

export interface CodeAppearanceProps {
  settings: Record<string, string>;
  onSetting: (key: string, value: string) => void;
}

type Mode = "dark" | "light";

/** The sample every preview paints. Deliberately short, and deliberately exercising all nine roles —
 *  a preview that shows only keywords and strings hides half of what you are about to pick. */
const SAMPLE = `// Electron main process
const { desktopCapturer } = require('electron');

async function getScreenStream(id) {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources.find(s => s.display_id === id) ?? null;   /* 30 fps */
}`;

/** Editable roles, in the order they are worth seeing. `plain` leads because it paints every
 *  character of an untagged fence, which is the one people notice first. */
const ROLE_ROWS: [Role, string][] = [
  ["plain", "Plain text"],
  ["comment", "Comment"],
  ["string", "String"],
  ["keyword", "Keyword"],
  ["number", "Number"],
  ["function", "Function call"],
  ["variable", "Variable"],
  ["type", "Type"],
  ["punct", "Punctuation"],
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The CSS variables one palette produces. Same names VaultModule writes onto the shell, so a
 *  preview and the real thing cannot drift. */
function varsFor(t: CodeTheme, font: string): React.CSSProperties {
  return {
    "--vault-code-background": t.background,
    "--vault-code-plain": t.colors.plain,
    "--vault-code-comment": t.colors.comment,
    "--vault-code-string": t.colors.string,
    "--vault-code-keyword": t.colors.keyword,
    "--vault-code-number": t.colors.number,
    "--vault-code-function": t.colors.function,
    "--vault-code-variable": t.colors.variable,
    "--vault-code-type": t.colors.type,
    "--vault-code-punct": t.colors.punct,
    "--vault-code-comment-style": t.commentItalic ? "italic" : "normal",
    ...(font ? { "--vault-code-font": `${font}, monospace` } : {}),
  } as React.CSSProperties;
}

export default function CodeAppearance({ settings, onSetting }: CodeAppearanceProps) {
  const api = vaultApi();
  const [found, setFound] = useState<VaultFoundTheme[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Which mode's swatch editor is open. Both closed by default — nine colour boxes on a settings
   *  page you opened to change one dropdown is noise. */
  const [editing, setEditing] = useState<Mode | null>(null);

  const font = (settings["code.font"] ?? "").trim();
  const numbers = settings["code.line_numbers"] === "1";

  const dark = useMemo(() => readTheme(settings["code.theme_dark"], "dark"), [settings]);
  const light = useMemo(() => readTheme(settings["code.theme_light"], "light"), [settings]);
  const themeOf = (m: Mode): CodeTheme => (m === "dark" ? dark : light);
  const keyOf = (m: Mode): string => (m === "dark" ? "code.theme_dark" : "code.theme_light");

  /**
   * What Visual Studio Code has installed here, listed once. Ungated and read-only: it opens a
   * public extensions folder and touches nothing in the vault, so it does not wait on the lock.
   */
  useEffect(() => {
    void api.findCodeThemes()
      .then((r) => { setFound(r.themes); setActiveName(r.active); })
      .catch(() => setFound([])); // no Visual Studio Code here is not an error, it is just no list
  }, [api]);

  /** Stored value → the id the dropdown should show. A custom or imported palette is not in the
   *  list, so it gets its own option rather than silently snapping back to a built-in. */
  const selected = (m: Mode): string => {
    const raw = settings[keyOf(m)];
    if (raw && BUILT_IN[raw]) return raw;
    return "__custom__";
  };

  const pick = useCallback((m: Mode, value: string): void => {
    setError(null);
    setNote(null);
    if (value === "__custom__") return; // it is already whatever it is; picking the label is a no-op
    if (BUILT_IN[value]) { onSetting(keyOf(m), value); return; }
    // Anything else is a theme file path from the installed list.
    setBusy(m);
    void api.readCodeTheme(value)
      .then((r) => {
        const out = importVsCodeTheme(r.raw, r.name);
        if (!out.ok || !out.theme) throw new Error(out.error ?? "That theme could not be read.");
        onSetting(keyOf(m), JSON.stringify(out.theme));
        setNote(`${out.theme.name} imported — ${out.mapped} of 8 colours came from the theme.`);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }, [api, onSetting]);

  /** Editing one swatch turns a built-in into a stored palette of its own. The original is never
   *  written over — it is a constant in the source — so Revert always has somewhere to go back to. */
  const setRole = (m: Mode, role: Role, hex: string): void => {
    if (!HEX.test(hex)) return; // half-typed is not a colour; the input keeps the text either way
    const t = themeOf(m);
    const next: CodeTheme = {
      ...t,
      name: t.name.startsWith("Custom") ? t.name : `Custom (from ${t.name})`,
      colors: { ...t.colors, [role]: hex },
    };
    onSetting(keyOf(m), JSON.stringify(next));
  };

  const setBackground = (m: Mode, hex: string): void => {
    if (!HEX.test(hex)) return;
    const t = themeOf(m);
    onSetting(keyOf(m), JSON.stringify({
      ...t, name: t.name.startsWith("Custom") ? t.name : `Custom (from ${t.name})`, background: hex,
    }));
  };

  const revert = (m: Mode): void => {
    onSetting(keyOf(m), m === "dark" ? DEFAULT_DARK : DEFAULT_LIGHT);
    setNote(null);
    setError(null);
  };

  const column = (m: Mode): React.ReactNode => {
    const t = themeOf(m);
    const sel = selected(m);
    const installed = found.filter((f) => f.uiTheme === null || f.uiTheme === m);
    return (
      <div>
        <div className="vault-flabel" style={{ marginBottom: 6 }}>
          {m === "dark" ? "Dark mode" : "Light mode"}
          {busy === m && <span className="vault-spinner" aria-hidden="true" style={{ marginLeft: 8 }} />}
        </div>
        <select
          value={sel}
          onChange={(e) => pick(m, e.target.value)}
          style={{ width: "100%", background: "var(--mc-field)", border: "1px solid var(--mc-border)", borderRadius: 8, padding: "7px 10px", color: "var(--mc-text)" }}
        >
          <option value={DEFAULT_DARK}>{BUILT_IN[DEFAULT_DARK].name}</option>
          <option value={DEFAULT_LIGHT}>{BUILT_IN[DEFAULT_LIGHT].name}</option>
          {sel === "__custom__" && <option value="__custom__">{t.name}</option>}
          {installed.length > 0 && (
            <optgroup label="Installed in Visual Studio Code">
              {installed.map((f) => (
                <option key={f.file} value={f.file}>
                  {f.label}{f.active ? "  — the one you are using" : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {/* THE PREVIEW IS THE REAL RENDERER — same component, same variables, scoped here. */}
        <div style={{ marginTop: 9, ...varsFor(t, font) }}>
          <CodeSample source={SAMPLE} language="javascript" lineNumbers={numbers} />
        </div>

        <div className="vault-btnrow" style={{ marginTop: 8, alignItems: "center" }}>
          <button className="vault-btn sm" onClick={() => setEditing(editing === m ? null : m)}>
            {editing === m ? "Done" : "Adjust colours"}
          </button>
          <button className="vault-btn sm" onClick={() => revert(m)}>Reset</button>
          <span className="vault-hint" style={{ flex: 1, textAlign: "right" }}>{t.name}</span>
        </div>

        {editing === m && (
          <div className="vault-swatches">
            <div className="vault-swatch">
              <span className="chip" style={{ background: t.background }} />
              <span className="nm">Background</span>
              <input
                value={t.background}
                spellCheck={false}
                onChange={(e) => setBackground(m, e.target.value.trim())}
              />
            </div>
            {ROLE_ROWS.map(([role, label]) => (
              <div className="vault-swatch" key={role}>
                <span className="chip" style={{ background: t.colors[role] }} />
                <span className="nm">{label}</span>
                <input
                  value={t.colors[role]}
                  spellCheck={false}
                  onChange={(e) => setRole(m, role, e.target.value.trim())}
                />
              </div>
            ))}
            <label className="vault-opt" style={{ gridColumn: "1 / -1" }}>
              <input
                type="checkbox"
                checked={t.commentItalic}
                onChange={(e) => onSetting(keyOf(m), JSON.stringify({ ...t, commentItalic: e.target.checked }))}
              />
              Comments in italic
            </label>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* ---- Code appearance (Jason 08-13-2026, MOCKUP-vault-code-appearance-v1) ---- */}
      <div className="vault-card">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Code appearance</span>
          <span className="vault-hint">
            {activeName ? `Visual Studio Code is using ${activeName}` : "Code blocks in notes, runbooks and ideas"}
          </span>
        </div>

        {/* NOT .vault-two — see .vault-codegrid in vault.css. Two fixed columns holding unwrapped
            code overflowed the card whenever the sidebar was open. */}
        <div className="vault-codegrid">
          {column("light")}
          {column("dark")}
        </div>

        {error && <div className="vault-hint" style={{ color: "var(--vault-danger-color)", marginTop: 10 }}>{error}</div>}
        {note && <div className="vault-hint" style={{ color: "var(--vault-strong-color)", marginTop: 10 }}>{note}</div>}

        <div className="vault-btnrow" style={{ marginTop: 14, alignItems: "center" }}>
          <span style={{ minWidth: 120 }}>Code font</span>
          <input
            value={font}
            placeholder="e.g. Cascadia Mono — empty uses the app's own"
            spellCheck={false}
            onChange={(e) => onSetting("code.font", e.target.value)}
            style={{ flex: 1, background: "var(--mc-field)", border: "1px solid var(--mc-border)", borderRadius: 8, padding: "7px 10px", color: "var(--mc-text)", fontFamily: "inherit" }}
          />
        </div>
        <label className="vault-opt" style={{ marginTop: 4 }}>
          <input
            type="checkbox"
            checked={numbers}
            onChange={(e) => onSetting("code.line_numbers", e.target.checked ? "1" : "0")}
          />
          Show line numbers in code blocks
        </label>

        <div className="vault-hint" style={{ marginTop: 10 }}>
          A theme you pick from the list is <b>read off this machine</b> and stored as colours in your vault — the
          extension is never bundled and nothing is downloaded. Only the colours a code block can actually use are
          taken; the rest of what a Visual Studio Code theme paints has no equivalent here. A fence with{" "}
          <b>no language tag stays plain</b> on the themed background, on purpose — guessing would shred an ASCII
          diagram.
        </div>
      </div>
    </>
  );
}
