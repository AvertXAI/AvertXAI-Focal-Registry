/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The collage (mockup surface 3) — THE main page. Coloured tiles you recognise without reading,
// which is the whole point once there are forty entries. Colour comes from brandTile.ts; read its
// header for why the tiles are brand COLOURS and initials rather than brand logo artwork.
//
// Clicking a tile opens the detail beside it — the same detail the three-pane view uses, so there
// is one implementation of "what an entry looks like" and not three that drift apart.
import { useMemo, useState } from "react";
import { brandColour, inkFor, monogram } from "./brandTile";
import DetailPane from "./DetailPane";
import type { VaultSecretMeta } from "./vaultApi";

export type CollageSort = "popular" | "recent" | "az";

export interface CollageViewProps {
  secrets: VaultSecretMeta[];
  sort: CollageSort;
  onSort: (s: CollageSort) => void;
  onReload: () => void;
  onNew: () => void;
  onEdit: (s: VaultSecretMeta) => void;
}

export default function CollageView({ secrets, sort, onSort, onReload, onNew, onEdit }: CollageViewProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const rows = [...secrets];
    if (sort === "az") rows.sort((a, b) => a.label.localeCompare(b.label));
    // "Popular" and "Recently used" both read the access log's derived last_read_at. Popular puts
    // never-read entries last (they have no evidence of use); recent puts them last too, but sorts
    // the rest strictly by when they were last opened.
    else rows.sort((a, b) => (b.last_read_at ?? "").localeCompare(a.last_read_at ?? "") || a.label.localeCompare(b.label));
    return rows;
  }, [secrets, sort]);

  const current = ordered.find((s) => s.uuid === selected) ?? null;

  const SORTS: [CollageSort, string][] = [
    ["popular", "Popular"],
    ["recent", "Recently used"],
    ["az", "A–Z"],
  ];

  return (
    <div className={current ? "vault-collagesplit" : ""}>
      <div className="vault-collagemain">
        <div className="vault-cardhead">
          <div className="vault-viewsw">
            {SORTS.map(([key, label]) => (
              <button key={key} className={`vault-swbtn${sort === key ? " on" : ""}`} onClick={() => onSort(key)}>
                {label}
              </button>
            ))}
          </div>
          <button className="vault-btn primary" onClick={onNew}>
            + New entry
          </button>
        </div>

        {ordered.length === 0 ? (
          <div className="vault-state">
            Nothing is stored in the vault yet.
            <div>
              <button className="vault-btn" onClick={onNew}>
                Add the first entry
              </button>
            </div>
          </div>
        ) : (
          <div className="vault-collage">
            {ordered.map((s) => {
              const colour = brandColour(s.label);
              return (
                <button
                  key={s.uuid}
                  className={`vault-tile${selected === s.uuid ? " on" : ""}`}
                  onClick={() => setSelected(selected === s.uuid ? null : s.uuid)}
                  title={s.username ? `${s.label} — ${s.username}` : s.label}
                >
                  <span className="vault-tilemark" style={{ background: colour, color: inkFor(colour) }}>
                    {monogram(s.label)}
                  </span>
                  <span className="vault-tilename">{s.label}</span>
                  {s.username && <span className="vault-tileuser">{s.username}</span>}
                  {s.favourite === 1 && <span className="vault-tilestar">★</span>}
                </button>
              );
            })}
            <button className="vault-tile add" onClick={onNew} title="New entry">
              <span className="vault-tileplus">+</span>
              <span className="vault-tilename">New entry</span>
            </button>
          </div>
        )}
      </div>

      {current && (
        <div className="vault-collagedetail">
          <DetailPane secret={current} onReload={onReload} onEdit={onEdit} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}
