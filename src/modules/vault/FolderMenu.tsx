/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The right-click "file this somewhere" menu, and the drag handle that makes a row draggable.
// Replaces the per-row dropdown, which Jason rejected on sight and was right to: a select box in
// a table cell reads as data entry, not as an action you take on the thing.
import { useEffect, useState } from "react";
import { vaultApi, type VaultFolder } from "./vaultApi";

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
export function useRowFiling() {
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

  return { menu, setMenu, rowProps };
}

/**
 * The other half of the gesture: a folder row that ACCEPTS a dragged entry. One implementation
 * for both folder lists — the outer rail and the three-pane nav. The pane nav had none at all,
 * which is why dragging a row onto the folder sitting right beside it did nothing: the only drop
 * targets in the product were two panes away. `null` means Unfiled, so a drop there un-files.
 */
export function useFolderDrop(onMoved: () => void) {
  // "none" rather than null, because null is a real target (Unfiled).
  const [over, setOver] = useState<number | null | "none">("none");

  const dropProps = (folderId: number | null) => ({
    onDragEnter: (e: React.DragEvent): void => {
      if (e.dataTransfer.types.includes("text/vault-secret")) e.preventDefault();
    },
    onDragOver: (e: React.DragEvent): void => {
      // Only claim the drop when it is one of OUR rows — otherwise a file dragged in from the
      // desktop would look droppable and then do nothing.
      if (!e.dataTransfer.types.includes("text/vault-secret")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(folderId);
    },
    onDragLeave: (): void => setOver("none"),
    onDrop: (e: React.DragEvent): void => {
      e.preventDefault();
      setOver("none");
      const uuid = e.dataTransfer.getData("text/vault-secret");
      if (!uuid) return;
      void vaultApi().updateMeta(uuid, { folderId }).then(onMoved).catch(() => undefined);
    },
  });

  return { over, dropProps };
}
