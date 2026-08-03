/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Home — baseplate landing. Module cards render from the Config-as-Data rows (same source as the
// flyout nav); the always-present Data Viewer keeps its own hardcoded card (core surface, not a module).
import type { View } from "../App";
import type { ModuleRow } from "../shared/types";
import { Database } from "../icons";
import { bumpRender } from "../diag";

// Card copy per module slug — presentation only (the modules table drives nav, not marketing copy;
// same precedent as the hardcoded Data Viewer card). Unknown slugs fall back to "<type> module."
const CARD_COPY: Record<string, string> = {
  scan: "Backup drive scanner — gives you a blueprint of what's inside your folders.",
  rename: "A tool that adds a custom filename on top of your existing filenames, per file.",
  "mindmerge": "Keep your notes locally, encrypted.",
  "scout-viewer": "An encrypted web-based browser with custom tools, meant for data extraction and AI automations.",
  vault: "AES-256 encrypted vault that holds secrets, passwords and private notes. Includes a custom password generator, easy for the user.",
  marketplace: "Browse and subscribe to Focal Registry modules. Coming soon.",
  employees: "Track who worked, on what, at what rate — and what you have paid them. Coming soon.",
};

export default function Home({ onNavigate, modules }: { onNavigate: (v: View) => void; modules: ModuleRow[] }) {
  bumpRender("home"); // DIAG-2
  return (
    <main className="view shown">
      <div className="wrap">
        <h1 className="pagetitle">Home</h1>
        <p className="subtitle">Your AvertXAI platform baseplate. Modules dock into the flyout nav as they ship.</p>
        <div className="modgrid">
          <div className="modcard" onClick={() => onNavigate("data-viewer")} style={{ cursor: "pointer" }}>
            <div className="row1">
              <Database />
              <span className="name">Data Viewer</span>
            </div>
            <p>Read-only browser for the local SQLite database.</p>
            <span className="pill docked">Docked</span>
          </div>
          {modules
            .filter((m) => m.is_enabled === 1)
            .map((m) => (
              <div key={m.slug} className="modcard" onClick={() => onNavigate(m.slug)} style={{ cursor: "pointer" }}>
                <div className="row1">
                  <Database />
                  <span className="name">{m.name}</span>
                </div>
                <p>{CARD_COPY[m.slug] ?? `${m.type} module.`}</p>
                <span className="pill docked">Docked</span>
              </div>
            ))}
        </div>
      </div>
    </main>
  );
}
