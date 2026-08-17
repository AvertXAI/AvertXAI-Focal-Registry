/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Three-pane browse (mockup surface 2) and the folder tree (surface 4). They share this file
// because they share the same right-hand detail and the same list behaviour — only the left pane
// differs, and splitting that into two files would duplicate the two that matter.
import { useMemo, useState } from "react";
import BrandMark from "./BrandMark";
import { FolderContextMenu, useFolderDrop, useRowFiling } from "./FolderMenu";
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
  const api = vaultApi();
  const [scope, setScope] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  // Same two gestures as the list view — drag a row onto a folder in the rail, or right-click it.
  const { menu, setMenu, rowProps } = useRowFiling();
  // …and this pane's OWN folder rows accept the drop, because they are the folders sitting right
  // beside the row being dragged. Same hook as the outer rail.
  const { over, dropProps } = useFolderDrop(onReload);

  const rows = useMemo(() => {
    return secrets.filter((s) => {
      if (scope === "all") return !s.archived_at;
      if (scope === "favourites") return !s.archived_at && s.favourite === 1;
      if (scope === "archived") return Boolean(s.archived_at);
      if (scope === "unfiled") return !s.archived_at && s.folder_id == null;
      if (scope.startsWith("kind:")) return !s.archived_at && s.kind === scope.slice(5);
      if (scope.startsWith("folder:")) return !s.archived_at && s.folder_id === Number(scope.slice(7));
      return !s.archived_at;
    });
  }, [secrets, scope]);

  const current = rows.find((s) => s.uuid === selected) ?? null;

  /** `folderId` undefined = an ordinary nav row. null = Unfiled, which IS a drop target — that is
      how an entry comes back out of a folder. */
  const navRow = (key: string, label: string, count: number, folderId?: number | null) => (
    <button
      key={key}
      className={`vault-prow${scope === key ? " on" : ""}${folderId !== undefined && over === folderId ? " drop" : ""}`}
      onClick={() => { setScope(key); setSelected(null); }}
      {...(folderId === undefined ? {} : dropProps(folderId))}
      title={folderId === undefined ? undefined : "Drop an entry here to file it"}
    >
      <span className="vault-railname">{label}</span>
      <span className="vault-railcount">{count}</span>
    </button>
  );

  const active = secrets.filter((s) => !s.archived_at);

  return (
    <div className="vault-pane3">
      {menu && (
        <FolderContextMenu
          state={menu}
          folders={folders}
          onPick={(uuid, folderId) => {
            setMenu(null);
            void api.updateMeta(uuid, { folderId }).then(onReload).catch(() => undefined);
          }}
          onClose={() => setMenu(null)}
        />
      )}
      <div className="vault-pnav">
        {navRow("all", "All items", active.length)}
        {navRow("favourites", "Favourites", active.filter((s) => s.favourite === 1).length)}
        {navRow("archived", "Archived", secrets.filter((s) => s.archived_at).length)}
        <div className="vault-railhead">Types</div>
        {KINDS.map(([k, label]) => navRow(`kind:${k}`, label, active.filter((s) => s.kind === k).length))}
        {/* Unfiled is always here, folders or not: it is where everything starts, and an entry
            filed into a folder LEAVES this list — which is the whole point of filing it. */}
        <div className="vault-railhead">Folders</div>
        {navRow("unfiled", "Unfiled", active.filter((s) => s.folder_id == null).length, null)}
        {folders.map((f) => navRow(`folder:${f.id}`, f.name, active.filter((s) => s.folder_id === f.id).length, f.id))}
      </div>

      <div className="vault-plist">
        {rows.length === 0 ? (
          <div className="vault-state">Nothing here.</div>
        ) : (
          rows.map((s) => (
            <button
              key={s.uuid}
              className={`vault-irow${selected === s.uuid ? " on" : ""}`}
              onClick={() => setSelected(s.uuid)}
              {...rowProps(s.uuid, s.label)}
            >
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
