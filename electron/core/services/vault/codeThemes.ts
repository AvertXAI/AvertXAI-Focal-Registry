// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Finds the Visual Studio Code colour themes already installed on THIS machine, and
//              reads one when asked. Approved mockup MOCKUP-vault-code-appearance-v1-08-12-2026.
//
//              WHY THE APP READS THEM RATHER THAN SHIPPING THEM. Jason asked for his own theme
//              ("i want, for me, my vscode theme"). Bundling it would mean redistributing someone
//              else's work inside a commercial product — legal for an MIT theme with the notice
//              attached, and pointless, because the file is already sitting on his disk and any
//              theme he installs later would need the same treatment again. Reading is strictly
//              better: no licence bookkeeping, no staleness, and it works for the next theme too.
//
//              THIS IS READ-ONLY AND LOCAL. It opens files inside the extensions folder and the
//              user's own settings file, and it never writes, never deletes, and never reaches the
//              network — the Vault's no-network property is untouched (only the two breach checks
//              are exempt, see breach.ts).
//
//              NO PARSING HAPPENS HERE. The main process hands back raw text; codeTheme.ts in the
//              renderer turns it into a palette. One implementation of the mapping, and it is the
//              one covered by the proof.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/codeThemes.ts
//------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface FoundTheme {
  /** The label the extension gives it — "SynthWave '84". */
  label: string;
  /** "dark" | "light" | null when the manifest does not say. */
  uiTheme: "dark" | "light" | null;
  file: string;
  /** The extension folder's name, so two themes with the same label are still tellable apart. */
  extension: string;
  /** True for the one named in the user's own workbench.colorTheme — offered first. */
  active: boolean;
}

/** Every place Visual Studio Code keeps extensions on a normal install. */
function extensionRoots(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".vscode", "extensions"),
    path.join(home, ".vscode-insiders", "extensions"),
    path.join(home, ".vscode-server", "extensions"),
    path.join(home, ".cursor", "extensions"),
  ];
}

/** And where it keeps the settings that name the ACTIVE one. */
function settingsFiles(): string[] {
  const home = os.homedir();
  const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  return [
    path.join(appData, "Code", "User", "settings.json"),
    path.join(appData, "Code - Insiders", "User", "settings.json"),
    path.join(home, "Library", "Application Support", "Code", "User", "settings.json"),
    path.join(home, ".config", "Code", "User", "settings.json"),
  ];
}

/**
 * The name in `workbench.colorTheme`, if it can be found.
 *
 * Read with a REGEX rather than a JSON parse, and that is not laziness: a real settings file is
 * JSONC with comments and trailing commas, it is frequently mid-edit, and the whole feature must not
 * fail because the user happens to have a dangling brace three hundred lines below the line we want.
 */
export function activeThemeName(): string | null {
  for (const f of settingsFiles()) {
    try {
      const raw = fs.readFileSync(f, "utf8");
      const m = /"workbench\.colorTheme"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
      if (m) return m[1].replace(/\\(.)/g, "$1");
    } catch {
      /* not installed, or not readable — try the next one */
    }
  }
  return null;
}

/** A theme file path may be relative to the extension folder and may use either slash. */
function resolveThemePath(extDir: string, p: unknown): string | null {
  if (typeof p !== "string" || p.trim() === "") return null;
  const rel = p.replace(/^\.\//, "").replace(/\\/g, "/");
  const full = path.resolve(extDir, rel);
  // Never follow a manifest out of its own extension folder. A themes array is data from a
  // third-party package, and data does not get to name an arbitrary file for us to read.
  if (!full.startsWith(path.resolve(extDir) + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

/**
 * Every colour theme installed here, the active one flagged and sorted first.
 *
 * Bounded on purpose: extension folders routinely hold hundreds of directories, and this runs while
 * a settings page is opening. It reads one small package.json per folder and opens no theme file.
 */
export function findVsCodeThemes(limit = 200): { active: string | null; themes: FoundTheme[] } {
  const active = activeThemeName();
  const out: FoundTheme[] = [];

  for (const root of extensionRoots()) {
    let dirs: string[];
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue; // this flavour of Visual Studio Code is not installed
    }
    for (const dir of dirs) {
      if (out.length >= limit) break;
      const extDir = path.join(root, dir);
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(extDir, "package.json"), "utf8")) as {
          contributes?: { themes?: { label?: string; uiTheme?: string; path?: string }[] };
        };
        for (const t of pkg.contributes?.themes ?? []) {
          const file = resolveThemePath(extDir, t.path);
          if (!file) continue;
          const label = typeof t.label === "string" && t.label.trim() ? t.label.trim() : dir;
          out.push({
            label,
            uiTheme: t.uiTheme === "vs" ? "light" : t.uiTheme ? "dark" : null,
            file,
            extension: dir,
            active: active != null && label === active,
          });
        }
      } catch {
        /* not an extension, or its manifest is broken — it simply does not appear */
      }
    }
  }

  // The one they are actually using first, then alphabetically. A list of two hundred themes with
  // theirs buried at position 140 is the same problem the note search had.
  out.sort((a, b) => (a.active === b.active ? a.label.localeCompare(b.label) : a.active ? -1 : 1));
  return { active, themes: out };
}

const MAX_THEME_BYTES = 2_000_000; // a colour theme is tens of kilobytes; this is a runaway guard

/**
 * The raw text of one theme file. Parsing is the renderer's job — see the header.
 *
 * The path must be one this machine actually offers. The renderer hands back a path it was GIVEN,
 * but a trust boundary that trusts what it handed out is not one, and this is a read of an arbitrary
 * file path arriving from the renderer.
 */
export function readVsCodeTheme(file: unknown): { name: string; raw: string } {
  if (typeof file !== "string" || file.trim() === "") throw new Error("No theme file was named.");
  const wanted = path.resolve(file);
  const known = findVsCodeThemes().themes.find((t) => path.resolve(t.file) === wanted);
  if (!known) throw new Error("That theme is not one of the ones installed on this machine.");

  const stat = fs.statSync(wanted);
  if (!stat.isFile() || stat.size > MAX_THEME_BYTES) throw new Error("That theme file is not readable.");
  return { name: known.label, raw: fs.readFileSync(wanted, "utf8") };
}
