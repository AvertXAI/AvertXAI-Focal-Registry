/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Agents — internal Distributor view. Imports agent .md files from the two local repos into
// canon_agents (repos stay read-only) and browses them grouped by category, plus a ★ favorites
// group. Viewer is a popup modal: read-only until Edit unlocks it; then Save (to DB) or Cancel are
// the only ways out. Theming: shell --mc-* classes only.
import { useEffect, useState } from "react";
import type { AgentImportResult, CanonAgent } from "../../shared/types";
import { bumpRender } from "../../diag";

const IMPORT_PATHS = ["D:\\dev\\AvertXAI-Contains-Studio-Agents", "D:\\dev\\AvertXAI-Agency-Agents"];
const FAV = "★ favorites"; // pseudo-category key for the collapsible group

const rowBtn: React.CSSProperties = { background: "none", border: "none", padding: "4px 0 4px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", color: "inherit", font: "inherit" };

export default function AgentsView({ onBack }: { onBack: () => void }) {
  bumpRender("Agents"); // DIAG-2
  const [rows, setRows] = useState<CanonAgent[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set()); // expanded categories
  const [selected, setSelected] = useState<CanonAgent | null>(null); // body_md loaded via get()
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<AgentImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => void window.api.agents.list().then(setRows);
  useEffect(() => {
    load();
  }, []);

  // The native min/□/✕ overlay is OS-drawn above the DOM — dim it while the modal is open.
  useEffect(() => {
    void window.api.theme.setModalDim(selected !== null);
    return () => void window.api.theme.setModalDim(false);
  }, [selected]);

  const doImport = () => {
    setErr(null);
    setResult(null);
    setImporting(true);
    window.api.agents
      .importFromFolders(IMPORT_PATHS)
      .then((r) => {
        setResult(r);
        load();
      })
      .catch((e: unknown) => setErr(String(e)))
      .finally(() => setImporting(false));
  };

  const toggle = (cat: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const view = (a: CanonAgent) => {
    setErr(null);
    setEditMode(false);
    void window.api.agents
      .get(a.id)
      .then(setSelected)
      .catch((e: unknown) => setErr(String(e)));
  };
  const closeModal = () => {
    setSelected(null);
    setEditMode(false);
  };

  const startEdit = () => {
    if (!selected) return;
    setDraft(selected.body_md ?? "");
    setEditMode(true);
  };
  const saveEdit = () => {
    if (!selected) return;
    window.api.agents
      .update(selected.id, draft)
      .then(closeModal)
      .catch((e: unknown) => setErr(String(e)));
  };

  const toggleFavorite = (a: CanonAgent) =>
    void window.api.agents.setFavorite(a.id, a.is_favorite !== 1).then(load);

  const remove = (a: CanonAgent) => {
    if (!window.confirm(`Delete agent "${a.name}" from the DB? (The repo file is untouched.)`)) return;
    void window.api.agents.remove(a.id).then(() => {
      closeModal();
      load();
    });
  };

  const star = (a: CanonAgent) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        toggleFavorite(a);
      }}
      title={a.is_favorite === 1 ? "Remove favorite" : "Add favorite"}
      aria-label={a.is_favorite === 1 ? "Remove favorite" : "Add favorite"}
      style={{ background: "none", border: "none", cursor: "pointer", marginLeft: "auto", fontSize: 14, lineHeight: 1, color: a.is_favorite === 1 ? "var(--canon-distributor-favorite)" : "var(--mc-muted)" }}
    >
      {a.is_favorite === 1 ? "★" : "☆"}
    </button>
  );

  // category -> agents (rows arrive sorted by category, name)
  const groups = new Map<string, CanonAgent[]>();
  for (const a of rows) {
    const cat = a.category ?? "(uncategorized)";
    const g = groups.get(cat);
    if (g) g.push(a);
    else groups.set(cat, [a]);
  }
  const favorites = rows.filter((a) => a.is_favorite === 1);

  const group = (cat: string, agents: CanonAgent[], fav: boolean) => (
    <div className="modcard" key={cat} style={{ marginBottom: 10 }}>
      <button
        className="row1"
        onClick={() => toggle(cat)}
        style={{ justifyContent: "space-between", cursor: "pointer", background: "none", border: "none", padding: 0, color: "inherit", font: "inherit", display: "flex", alignItems: "center", width: "100%" }}
        aria-expanded={open.has(cat)}
      >
        <span className="name" style={fav ? { color: "var(--canon-distributor-favorite)" } : undefined}>
          {open.has(cat) ? "▾" : "▸"} {cat}/
        </span>
        <span className="badge b-pend">{agents.length}</span>
      </button>
      {open.has(cat) &&
        agents.map((a) => (
          <button key={a.uuid} onClick={() => view(a)} style={rowBtn}>
            <span style={{ fontSize: 13 }}>{fav ? `~/${a.category ?? "(uncategorized)"}/${a.name}` : a.name}</span>
            {star(a)}
          </button>
        ))}
    </div>
  );

  return (
    <main className="view shown">
      <div className="wrap">
        <button className="btn ghost" onClick={onBack} style={{ marginBottom: 10 }}>
          ← Back
        </button>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 className="pagetitle">Agents</h1>
          <button className="btn" onClick={doImport} disabled={importing}>
            {importing ? "Importing…" : "⤓ Import from folders"}
          </button>
        </div>
        <p className="subtitle">Agent library imported from the local repos — browse by category. Repos are never modified.</p>

        {err !== null && (
          <p className="hint" style={{ color: "var(--canon-distributor-error)", marginBottom: 10 }}>
            {err}
          </p>
        )}
        {result !== null && (
          <p className="hint" style={{ color: "var(--mc-green)", marginBottom: 10 }}>
            Imported {result.imported}, updated {result.updated}, across {result.categories} categories.
          </p>
        )}

        {favorites.length > 0 && group(FAV, favorites, true)}
        {[...groups.entries()].map(([cat, agents]) => group(cat, agents, false))}

        {rows.length === 0 && <p className="hint">No agents yet — Import from folders above.</p>}
      </div>

      {selected !== null && (
        // Outside click closes ONLY in view mode — while editing, Save/Cancel are the only exits.
        <div className="overlay" onClick={() => (editMode ? undefined : closeModal())}>
          <div className="modal" style={{ width: "min(860px, 94vw)" }} role="dialog" aria-label="Agent viewer" onClick={(e) => e.stopPropagation()}>
            <h3>{selected.name}</h3>

            {err !== null && (
              <p className="hint" style={{ color: "var(--canon-distributor-error)", marginBottom: 10 }}>
                {err}
              </p>
            )}

            {editMode ? (
              <textarea
                className="log"
                style={{ width: "100%", minHeight: 380, resize: "vertical", color: "inherit", display: "block" }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
            ) : (
              <pre className="log" style={{ whiteSpace: "pre-wrap", maxHeight: 380, overflowY: "auto" }}>{selected.body_md}</pre>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
              <button className="btn stop" onClick={() => remove(selected)}>
                Delete
              </button>
              {editMode ? (
                <>
                  <button className="btn primary" style={{ marginLeft: "auto" }} onClick={saveEdit}>
                    Save
                  </button>
                  <button className="btn ghost" onClick={closeModal}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button className="btn" style={{ marginLeft: "auto" }} onClick={startEdit}>
                    Edit
                  </button>
                  <button className="btn ghost" onClick={closeModal}>
                    Close
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
