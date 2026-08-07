/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Folders, in the LEFT RAIL under the search box — where the mockup puts navigation, and where a
// drop target has to be if dragging an entry onto a folder is going to feel natural.
//
// TWO WAYS TO FILE SOMETHING, no dropdown (Jason, 08-07-2026): drag a row onto a folder, or
// right-click the row and pick one. A select box in a table cell is a form control pretending to
// be an action — it reads as data entry, not as filing.
import { useState } from "react";
import { vaultApi, type VaultFolder, type VaultSecretMeta } from "./vaultApi";

export interface FolderRailProps {
  folders: VaultFolder[];
  secrets: VaultSecretMeta[];
  selected: string;
  onSelect: (filter: string) => void;
  onChanged: () => void;
}

interface TreeNode {
  folder: VaultFolder;
  depth: number;
}

/** Flattens the tree for rendering. Orphans (a parent that no longer exists) lift to the top
    rather than disappearing — a folder that vanishes from the screen reads as data loss. */
function flatten(folders: VaultFolder[]): TreeNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<number | null, VaultFolder[]>();
  for (const f of folders) {
    const key = f.parent_id != null && byId.has(f.parent_id) ? f.parent_id : null;
    children.set(key, [...(children.get(key) ?? []), f]);
  }
  const walk = (parent: number | null, depth: number): TreeNode[] =>
    (children.get(parent) ?? []).flatMap((folder) => [{ folder, depth }, ...walk(folder.id, depth + 1)]);
  return walk(null, 0);
}

export default function FolderRail({ folders, secrets, selected, onSelect, onChanged }: FolderRailProps) {
  const api = vaultApi();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [dropTarget, setDropTarget] = useState<number | null | "none">("none");
  const [error, setError] = useState<string | null>(null);

  const active = secrets.filter((s) => !s.archived_at);
  const unfiled = active.filter((s) => s.folder_id == null).length;
  const tree = flatten(folders);

  const create = (): void => {
    setError(null);
    void api
      .createFolder(name, null)
      .then(() => {
        setName("");
        setAdding(false);
        onChanged();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  /** A row was dropped on a folder. The uuid travels as plain text — never a credential. */
  const drop = (folderId: number | null) => (e: React.DragEvent): void => {
    e.preventDefault();
    setDropTarget("none");
    const uuid = e.dataTransfer.getData("text/vault-secret");
    if (!uuid) return;
    void api.updateMeta(uuid, { folderId }).then(onChanged).catch(() => undefined);
  };

  const allow = (folderId: number | null) => (e: React.DragEvent): void => {
    // Only claim the drop when it is one of OUR rows — otherwise a file dragged in from the
    // desktop would look droppable and then do nothing.
    if (!e.dataTransfer.types.includes("text/vault-secret")) return;
    e.preventDefault();
    setDropTarget(folderId);
  };

  return (
    <>
      <div className="vault-railhead">
        Folders
        <button className="vault-railadd" title="New folder" onClick={() => setAdding((a) => !a)}>
          +
        </button>
      </div>

      {/* THE EMPTY-STATE NUDGE (Jason 08-07-2026): only when there is something to file. An empty
          vault gets nothing — telling someone to organise nothing is noise. */}
      {folders.length === 0 && active.length > 0 && (
        <button className="vault-foldernudge" onClick={() => setAdding(true)}>
          <b>{active.length} entries, no folders yet.</b>
          <span>Group them by what they are — Personal, Money, Photography. Start one.</span>
        </button>
      )}

      {adding && (
        <div className="vault-folderadd">
          <input
            value={name}
            autoFocus
            placeholder="Folder name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) create();
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <button className="vault-btn primary" disabled={!name.trim()} onClick={create}>
            Add
          </button>
        </div>
      )}
      {error && <div className="vault-lockerror" style={{ margin: "0 9px" }}>{error}</div>}

      {(folders.length > 0 || active.length > 0) && (
        <button
          className={`vault-railrow${selected === "unfiled" ? " on" : ""}${dropTarget === null ? " drop" : ""}`}
          onClick={() => onSelect("unfiled")}
          onDragOver={allow(null)}
          onDragLeave={() => setDropTarget("none")}
          onDrop={drop(null)}
        >
          <span className="vault-raildot" style={{ background: "var(--mc-dimmer)" }} />
          <span className="vault-railname">Unfiled</span>
          <span className="vault-railcount">{unfiled}</span>
        </button>
      )}

      {tree.map(({ folder, depth }) => (
        <button
          key={folder.id}
          className={`vault-railrow${selected === `folder:${folder.id}` ? " on" : ""}${dropTarget === folder.id ? " drop" : ""}`}
          style={{ paddingLeft: 9 + depth * 12 }}
          onClick={() => onSelect(`folder:${folder.id}`)}
          onDragOver={allow(folder.id)}
          onDragLeave={() => setDropTarget("none")}
          onDrop={drop(folder.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            if (confirm(`Delete the folder "${folder.name}"? Nothing inside it is deleted — those entries move back to Unfiled.`)) {
              void api.deleteFolder(folder.id).then(onChanged).catch(() => undefined);
            }
          }}
          title="Drop an entry here to file it · right-click to delete"
        >
          <span className="vault-raildot" style={{ background: "var(--mc-accent-primary)" }} />
          <span className="vault-railname">{folder.name}</span>
          <span className="vault-railcount">{active.filter((s) => s.folder_id === folder.id).length}</span>
        </button>
      ))}
    </>
  );
}
