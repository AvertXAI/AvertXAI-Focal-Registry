/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Templates — internal Distributor view. Gallery + modal editor over canon_templates via
// window.api.templates. The editor is an ORDERED, SECTIONED CLAUDE.md builder: standard skeleton
// sections (fixed headings, H2/H3 toggle) + custom sections (editable, removable, reorderable),
// assembled into body_md on save; sections_json keeps the structural form. The ONLY disk write is
// the guarded "Write CLAUDE.md" button (service refuses to overwrite without an explicit confirm).
// Theming: shell --mc-* classes only (.modcard/.addcard/.input/.btn/.overlay/.modal/.badge/.log).
import { useEffect, useState } from "react";
import type { CanonTemplate, TemplateSection } from "../../shared/types";
import { bumpRender } from "../../diag";
import { assembleBody, skeletonSections, standardSections } from "./claudeMdStandard";

// Increment the patch of a "vX.Y.Z" string (Save & Bump). Non-semver strings pass through unchanged.
function bumpPatch(v: string): string {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? `v${m[1]}.${m[2]}.${Number(m[3]) + 1}` : v;
}

// sections_json → sections, tolerating legacy rows saved before the builder existed: their flat
// body_md lands in the intro section so nothing the user wrote is hidden.
function parseSections(t: CanonTemplate): TemplateSection[] {
  if (t.sections_json) {
    try {
      const arr = JSON.parse(t.sections_json) as TemplateSection[];
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch {
      /* fall through to skeleton */
    }
  }
  const sk = skeletonSections();
  sk[0].body = t.body_md;
  return sk;
}

export default function TemplatesView({ onBack }: { onBack: () => void }) {
  bumpRender("Templates"); // DIAG-2
  const [rows, setRows] = useState<CanonTemplate[]>([]);
  const [editing, setEditing] = useState<CanonTemplate | "new" | null>(null); // null = gallery only
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [sections, setSections] = useState<TemplateSection[]>([]);
  const [version, setVersion] = useState("v0.1.0");
  const [showPreview, setShowPreview] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null); // non-error status (e.g. "written to …")

  const load = () => void window.api.templates.list().then(setRows);
  useEffect(() => {
    load();
  }, []);

  // The native min/□/✕ overlay is OS-drawn above the DOM — dim it while the modal is open so it
  // recedes with the backdrop, and always restore on close/unmount.
  useEffect(() => {
    void window.api.theme.setModalDim(editing !== null);
    return () => void window.api.theme.setModalDim(false);
  }, [editing]);

  const openNew = () => {
    setEditing("new");
    setTitle("");
    setDestination("");
    setSections(skeletonSections());
    setVersion("v0.1.0");
    setShowPreview(false);
    setErr(null);
    setNote(null);
  };
  const openEdit = (t: CanonTemplate) => {
    setEditing(t);
    setTitle(t.title);
    setDestination(t.destination ?? "");
    setSections(parseSections(t));
    setVersion(t.version);
    setShowPreview(false);
    setErr(null);
    setNote(null);
  };
  const closeEditor = () => setEditing(null);

  const browseDest = () =>
    void window.api.dist.pickFolder().then((p) => {
      if (p) setDestination(p);
    });

  // --- section ops (index 0 = the pinned intro) ---
  const patchSection = (i: number, patch: Partial<TemplateSection>) =>
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const moveSection = (i: number, delta: -1 | 1) =>
    setSections((prev) => {
      const j = i + delta;
      if (i <= 0 || j <= 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const removeSection = (i: number) => setSections((prev) => prev.filter((_, idx) => idx !== i));
  const addSection = () =>
    setSections((prev) => [...prev, { heading: "", level: 2, body: "", fixed: false, guidance: "Section content." }]);

  const loadStandard = () => {
    if (sections.some((s) => s.body.trim() !== "") && !window.confirm("Replace current section contents with the AvertXAI standard?")) return;
    setSections(standardSections());
  };

  // Persist WITHOUT closing (Write CLAUDE.md needs the saved row). Returns the fresh row.
  const persist = async (bump: boolean): Promise<CanonTemplate> => {
    const payload = {
      title: title.trim(),
      destination: destination.trim(),
      body_md: assembleBody(sections),
      version: bump ? bumpPatch(version) : version,
      sections_json: JSON.stringify(sections),
    };
    const row =
      editing === "new" || editing === null
        ? await window.api.templates.create(payload)
        : await window.api.templates.update(editing.id, payload);
    setEditing(row);
    setVersion(row.version);
    load();
    return row;
  };

  const save = (bump: boolean) => {
    setErr(null);
    persist(bump)
      .then(closeEditor)
      .catch((e: unknown) => setErr(String(e)));
  };

  const writeDisk = async () => {
    setErr(null);
    setNote(null);
    try {
      const row = await persist(false);
      let r = await window.api.templates.writeToDisk(row.id);
      if (r.status === "no-destination") {
        setErr("Set a destination folder first — Write CLAUDE.md needs somewhere to write.");
        return;
      }
      if (r.status === "exists") {
        if (!window.confirm(`CLAUDE.md exists at ${r.path} — overwrite?`)) return;
        r = await window.api.templates.writeToDisk(row.id, true);
      }
      if (r.status === "written") setNote(`Written to ${r.path}`);
    } catch (e) {
      setErr(String(e));
    }
  };

  const remove = (t: CanonTemplate) => {
    if (!window.confirm(`Delete template "${t.title}"? This cannot be undone.`)) return;
    void window.api.templates.remove(t.id).then(() => {
      closeEditor();
      load();
    });
  };

  return (
    <main className="view shown">
      <div className="wrap">
        <button className="btn ghost" onClick={onBack} style={{ marginBottom: 10 }}>
          ← Back
        </button>
        <h1 className="pagetitle">Templates</h1>
        <p className="subtitle">Sectioned CLAUDE.md builder — stored in the DB; writes to disk only on your explicit confirm.</p>

        <div className="modgrid">
          {/* + Add Template tile */}
          <button className="addcard" onClick={openNew} style={{ alignItems: "flex-start", cursor: "pointer", textAlign: "left" }}>
            <span className="name" style={{ fontWeight: 600 }}>＋ Add Template</span>
            <span className="hint" style={{ margin: 0 }}>Start from the standard CLAUDE.md skeleton</span>
          </button>

          {rows.map((t) => (
            <button className="modcard" key={t.uuid} onClick={() => openEdit(t)} style={{ cursor: "pointer", textAlign: "left" }}>
              <div className="row1" style={{ justifyContent: "space-between" }}>
                <span className="name">{t.title}</span>
                <span className="badge b-pend">{t.version}</span>
              </div>
              <div className="pathline">writes as {t.writes_as}</div>
              {t.destination && <div className="pathline">→ {t.destination}</div>}
            </button>
          ))}
        </div>

        {rows.length === 0 && <p className="hint">No templates yet — add one above.</p>}
      </div>

      {editing !== null && (
        <div className="overlay" onClick={closeEditor}>
          <div className="modal" style={{ width: "min(860px, 94vw)" }} role="dialog" aria-label="Template editor" onClick={(e) => e.stopPropagation()}>
            <h3>{editing === "new" ? "New template" : "Edit template"}</h3>

            {err !== null && (
              <p className="hint" style={{ color: "var(--canon-distributor-error)", marginBottom: 10 }}>
                {err}
              </p>
            )}
            {note !== null && (
              <p className="hint" style={{ color: "var(--mc-green)", marginBottom: 10 }}>
                {note}
              </p>
            )}

            <div className="field">
              <label htmlFor="tpl-title">Title</label>
              <input id="tpl-title" className="input" style={{ maxWidth: "none" }} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label>Writes as</label>
              <input className="input" style={{ maxWidth: "none" }} value="CLAUDE.md" readOnly aria-readonly="true" />
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="tpl-dest">Destination</label>
              <div className="fieldrow">
                <input id="tpl-dest" className="input" style={{ flex: 1, maxWidth: "none" }} placeholder="Absolute path (optional)" value={destination} onChange={(e) => setDestination(e.target.value)} />
                <button className="btn ghost" onClick={browseDest}>
                  Browse…
                </button>
              </div>
            </div>

            {/* --- sectioned builder --- */}
            <div className="fieldrow" style={{ marginTop: 16, alignItems: "center" }}>
              <span className="name" style={{ fontWeight: 600 }}>Sections</span>
              <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={loadStandard}>
                ⤓ Load AvertXAI Standard
              </button>
              <button className="btn ghost" onClick={() => setShowPreview((p) => !p)}>
                {showPreview ? "Hide preview" : "Preview"}
              </button>
            </div>

            {sections.map((s, i) => (
              <div key={i} className="field" style={{ marginTop: 10, borderTop: i > 0 ? "1px solid var(--mc-border)" : "none", paddingTop: i > 0 ? 10 : 0 }}>
                <div className="fieldrow" style={{ alignItems: "center", gap: 8 }}>
                  {s.fixed ? (
                    <label style={{ margin: 0 }}>
                      {s.level === 1 ? "# " : s.level === 2 ? "## " : "### "}
                      {s.heading}
                    </label>
                  ) : (
                    <>
                      <span className="hint" style={{ margin: 0 }}>{s.level === 2 ? "##" : "###"}</span>
                      <input className="input" style={{ flex: 1, maxWidth: "none" }} placeholder="Section heading" value={s.heading} onChange={(e) => patchSection(i, { heading: e.target.value })} />
                    </>
                  )}
                  {s.level !== 1 && (
                    <button className="btn ghost" title="Toggle heading level" onClick={() => patchSection(i, { level: s.level === 2 ? 3 : 2 })}>
                      {s.level === 2 ? "H2" : "H3"}
                    </button>
                  )}
                  {i > 0 && (
                    <>
                      <button className="btn ghost" title="Move up" aria-label="Move up" onClick={() => moveSection(i, -1)} disabled={i <= 1}>
                        ↑
                      </button>
                      <button className="btn ghost" title="Move down" aria-label="Move down" onClick={() => moveSection(i, 1)} disabled={i >= sections.length - 1}>
                        ↓
                      </button>
                    </>
                  )}
                  {!s.fixed && (
                    <button className="btn ghost" title="Remove section" aria-label="Remove section" onClick={() => removeSection(i)}>
                      ✕
                    </button>
                  )}
                </div>
                <textarea className="tpl-body" style={{ minHeight: 88, marginTop: 6 }} value={s.body} placeholder={s.guidance} onChange={(e) => patchSection(i, { body: e.target.value })} />
              </div>
            ))}

            <button className="btn ghost" style={{ marginTop: 10 }} onClick={addSection}>
              ＋ Add section
            </button>

            {showPreview && (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Preview — assembled markdown</label>
                <pre className="log" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{assembleBody(sections)}</pre>
              </div>
            )}

            <div className="fieldrow" style={{ marginTop: 16, alignItems: "center" }}>
              {editing !== "new" && (
                <button className="btn stop" onClick={() => remove(editing)}>
                  Delete
                </button>
              )}
              <button className="btn ghost" style={{ marginLeft: "auto" }} onClick={closeEditor}>
                Cancel
              </button>
              <button className="btn" onClick={() => void writeDisk()} disabled={title.trim().length === 0} title="Save, then write the assembled CLAUDE.md to the destination (confirms before overwriting)">
                Write CLAUDE.md
              </button>
              <button className="btn" onClick={() => save(false)} disabled={title.trim().length === 0}>
                Save
              </button>
              <button className="btn primary" onClick={() => save(true)} disabled={title.trim().length === 0} title={`Bump ${version} → ${bumpPatch(version)}`}>
                Save &amp; Bump
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
