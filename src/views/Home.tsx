/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Home — baseplate landing. Module cards render from the Config-as-Data rows (same source as the
// flyout nav); the always-present Data Viewer keeps its own hardcoded card (core surface, not a module).
import type { View } from "../App";
import type { ModuleRow } from "../shared/types";
import { Database } from "../icons";
import { bumpRender } from "../diag";

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
                <p>{m.type} module.</p>
                <span className="pill docked">Docked</span>
              </div>
            ))}
        </div>
      </div>
    </main>
  );
}
