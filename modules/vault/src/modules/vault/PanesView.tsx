/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Three-pane browse (mockup surface 2) and the folder tree (surface 4). They share this file
// because they share the same right-hand detail and the same list behaviour — only the left pane
// differs, and splitting that into two files would duplicate the two that matter.
import { useMemo, useState } from "react";
import BrandMark from "./BrandMark";
import DetailPane from "./DetailPane";
import { vaultApi, type VaultFolder, type VaultSecretMeta } from "./vaultApi";

// ---------------------------------------------------------------- three-pane
export interface PanesViewProps {
  secrets: VaultSecretMeta[];
  folders: VaultFolder[];
  onReload: () => void;
  onNew: () => void;
  onEdit: (s: VaultSecretMeta) => void;
}

const KINDS: [string, string][] = [
  ["login", "Logins"],
  ["api_key", "API keys"],
  ["financial", "Financial"],
  ["taxpayer_id", "Taxpayer IDs"],
];

export function PanesView({ secrets, folders, onReload, onNew, onEdit }: PanesViewProps) {
  const [scope, setScope] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo(() => {
    return secrets.filter((s) => {
      if (scope === "all") return !s.archived_at;
      if (scope === "favourites") return !s.archived_at && s.favourite === 1;
      if (scope === "archived") return Boolean(s.archived_at);
      if (scope.startsWith("kind:")) return !s.archived_at && s.kind === scope.slice(5);
      if (scope.startsWith("folder:")) return !s.archived_at && s.folder_id === Number(scope.slice(7));
      return !s.archived_at;
    });
  }, [secrets, scope]);

  const current = rows.find((s) => s.uuid === selected) ?? null;

  const navRow = (key: string, label: string, count: number) => (
    <button key={key} className={`vault-prow${scope === key ? " on" : ""}`} onClick={() => { setScope(key); setSelected(null); }}>
      <span className="vault-railname">{label}</span>
      <span className="vault-railcount">{count}</span>
    </button>
  );

  const active = secrets.filter((s) => !s.archived_at);

  return (
    <div className="vault-pane3">
      <div className="vault-pnav">
        {navRow("all", "All items", active.length)}
        {navRow("favourites", "Favourites", active.filter((s) => s.favourite === 1).length)}
        {navRow("archived", "Archived", secrets.filter((s) => s.archived_at).length)}
        <div className="vault-railhead">Types</div>
        {KINDS.map(([k, label]) => navRow(`kind:${k}`, label, active.filter((s) => s.kind === k).length))}
        {folders.length > 0 && (
          <>
            <div className="vault-railhead">Folders</div>
            {folders.map((f) => navRow(`folder:${f.id}`, f.name, active.filter((s) => s.folder_id === f.id).length))}
          </>
        )}
      </div>

      <div className="vault-plist">
        {rows.length === 0 ? (
          <div className="vault-state">Nothing here.</div>
        ) : (
          rows.map((s) => (
            <button key={s.uuid} className={`vault-irow${selected === s.uuid ? " on" : ""}`} onClick={() => setSelected(s.uuid)}>
              <BrandMark label={s.label} size={32} />
              <span style={{ minWidth: 0 }}>
                <span className="vault-irowtitle">{s.label}</span>
                <span className="vault-irowsub">{s.username ?? s.url ?? "—"}</span>
              </span>
              {s.favourite === 1 && <span className="vault-tilestar" style={{ position: "static", marginLeft: "auto" }}>★</span>}
            </button>
          ))
        )}
      </div>

      <div className="vault-pdetail">
        {current ? (
          <DetailPane secret={current} onReload={onReload} onEdit={onEdit} />
        ) : (
          <div className="vault-state">
            Pick an entry to see it.
            <div>
              <button className="vault-btn" onClick={onNew}>
                + New entry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- folder tree
export interface FoldersViewProps {
  secrets: VaultSecretMeta[];
  folders: VaultFolder[];
  onReload: () => void;
  onFoldersChanged: () => void;
  onEdit: (s: VaultSecretMeta) => void;
}

interface TreeNode {
  folder: VaultFolder;
  children: TreeNode[];
  depth: number;
}

/** Builds the tree from the flat rows. Orphans (a parent that no longer exists) are lifted to the
    top rather than dropped — a folder that vanishes from the screen looks like data loss. */
function buildTree(folders: VaultFolder[]): TreeNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const childrenOf = new Map<number | null, VaultFolder[]>();
  for (const f of folders) {
    const key = f.parent_id != null && byId.has(f.parent_id) ? f.parent_id : null;
    const list = childrenOf.get(key) ?? [];
    list.push(f);
    childrenOf.set(key, list);
  }
  const walk = (parent: number | null, depth: number): TreeNode[] =>
    (childrenOf.get(parent) ?? []).map((folder) => ({ folder, depth, children: walk(folder.id, depth + 1) }));
  return walk(null, 0);
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

export function FoldersView({ secrets, folders, onReload, onFoldersChanged, onEdit }: FoldersViewProps) {
  const api = vaultApi();
  const [selected, setSelected] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const flat = useMemo(() => flatten(buildTree(folders)), [folders]);
  const active = secrets.filter((s) => !s.archived_at);
  const inFolder = selected === null ? active.filter((s) => s.folder_id == null) : active.filter((s) => s.folder_id === selected);
  const selectedFolder = folders.find((f) => f.id === selected) ?? null;

  const create = (): void => {
    setError(null);
    void api
      .createFolder(newName, selected)
      .then(() => {
        setNewName("");
        onFoldersChanged();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const remove = (id: number): void => {
    setError(null);
    void api
      .deleteFolder(id)
      .then(() => {
        if (selected === id) setSelected(null);
        onFoldersChanged();
        onReload();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="vault-folderwrap">
      <div className="vault-card vault-foldertree">
        <div className="vault-cardhead">
          <span className="vault-cardtitle">Folders</span>
        </div>
        <button className={`vault-tnode${selected === null ? " on" : ""}`} onClick={() => setSelected(null)}>
          <span className="vault-railname">🗀 Unfiled</span>
          <span className="vault-railcount">{active.filter((s) => s.folder_id == null).length}</span>
        </button>
        {flat.map((n) => (
          <div key={n.folder.id} className="vault-tnoderow" style={{ paddingLeft: n.depth * 16 }}>
            <button className={`vault-tnode${selected === n.folder.id ? " on" : ""}`} onClick={() => setSelected(n.folder.id)}>
              <span className="vault-railname">🗀 {n.folder.name}</span>
              <span className="vault-railcount">{active.filter((s) => s.folder_id === n.folder.id).length}</span>
            </button>
            <button className="vault-btn" title="Delete this folder" onClick={() => remove(n.folder.id)}>
              ✕
            </button>
          </div>
        ))}
        {error && <div className="vault-state error">{error}</div>}
        <div className="vault-field" style={{ marginTop: 12 }}>
          <label htmlFor="f-new">
            New folder{selectedFolder ? ` inside ${selectedFolder.name}` : " at the top level"}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="f-new" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Infrastructure" />
            <button className="vault-btn primary" disabled={!newName.trim()} onClick={create}>
              Add
            </button>
          </div>
        </div>
        <div className="vault-hint" style={{ marginTop: 10 }}>
          Deleting a folder never deletes what is inside it — those entries move back to Unfiled.
        </div>
      </div>

      <div className="vault-card" style={{ flex: 1, minWidth: 0 }}>
        <div className="vault-cardhead">
          <span className="vault-cardtitle">{selectedFolder ? selectedFolder.name : "Unfiled"}</span>
        </div>
        {inFolder.length === 0 ? (
          <div className="vault-state">This folder is empty.</div>
        ) : (
          <table className="vault-table">
            <thead>
              <tr>
                <th>Record</th>
                <th>Username</th>
                <th>Move to</th>
              </tr>
            </thead>
            <tbody>
              {inFolder.map((s) => (
                <tr key={s.uuid}>
                  <td>
                    <button className="vault-linkrow" onClick={() => onEdit(s)}>
                      <BrandMark label={s.label} size={28} />
                      <b>{s.label}</b>
                    </button>
                  </td>
                  <td className="vault-who">{s.username ?? "—"}</td>
                  <td>
                    <select
                      value={s.folder_id ?? ""}
                      onChange={(e) => void api.updateMeta(s.uuid, { folderId: e.target.value === "" ? null : Number(e.target.value) }).then(onReload)}
                      style={{ background: "var(--mc-field)", border: "1px solid var(--mc-border)", borderRadius: 7, padding: "5px 9px", color: "var(--mc-text)", fontSize: 12 }}
                    >
                      <option value="">Unfiled</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
