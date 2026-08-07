/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The right-click "file this somewhere" menu, and the drag handle that makes a row draggable.
// Replaces the per-row dropdown, which Jason rejected on sight and was right to: a select box in
// a table cell reads as data entry, not as an action you take on the thing.
import { useEffect, useState } from "react";
import type { VaultFolder } from "./vaultApi";

export interface FolderMenuState {
  uuid: string;
  label: string;
  x: number;
  y: number;
}

export function FolderContextMenu({
  state,
  folders,
  onPick,
  onClose,
}: {
  state: FolderMenuState;
  folders: VaultFolder[];
  onPick: (uuid: string, folderId: number | null) => void;
  onClose: () => void;
}) {
  // Any click anywhere else, or Escape, closes it — a context menu that needs its own X is a
  // dialog wearing the wrong clothes.
  useEffect(() => {
    const away = (): void => onClose();
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", away);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      className="vault-ctxmenu"
      style={{ left: state.x, top: state.y }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
    >
      <div className="vault-ctxhead">Move “{state.label}” to</div>
      <button className="vault-ctxitem" onClick={() => onPick(state.uuid, null)}>
        Unfiled
      </button>
      {folders.length === 0 ? (
        <div className="vault-ctxempty">No folders yet — make one in the sidebar.</div>
      ) : (
        folders.map((f) => (
          <button key={f.id} className="vault-ctxitem" onClick={() => onPick(state.uuid, f.id)}>
            🗀 {f.name}
          </button>
        ))
      )}
    </div>
  );
}

/** Hook wiring a list row up to both gestures: drag it, or right-click it. */
export function useRowFiling(onMoved: () => void) {
  const [menu, setMenu] = useState<FolderMenuState | null>(null);

  const rowProps = (uuid: string, label: string) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent): void => {
      // A private mime type, so only our own drop targets light up — and so the payload is a
      // locator, never anything that could be a credential.
      e.dataTransfer.setData("text/vault-secret", uuid);
      e.dataTransfer.effectAllowed = "move";
    },
    onContextMenu: (e: React.MouseEvent): void => {
      e.preventDefault();
      setMenu({ uuid, label, x: e.clientX, y: e.clientY });
    },
    title: "Drag onto a folder, or right-click to file it",
  });

  return { menu, setMenu, rowProps, onMoved };
}
