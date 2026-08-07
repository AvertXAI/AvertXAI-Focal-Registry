/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// ONE tile mark, used by every view — collage, three-pane, folder tree and list. Because all four
// call this, dropping real icon artwork in later (brandTile.iconPathFor) lights up every surface at
// once instead of four separate edits that drift.
import { brandColour, iconPathFor, inkFor, monogram } from "./brandTile";

export default function BrandMark({ label, size = 34 }: { label: string; size?: number }) {
  const colour = brandColour(label);
  const ink = inkFor(colour);
  const path = iconPathFor(label);
  return (
    <span
      className="vault-mark"
      style={{ background: colour, color: ink, width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {path ? (
        // A monochrome set draws in currentColor, so it takes the readable ink over the brand
        // colour automatically — that is the "adjust them to colour" path, already wired.
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} fill="currentColor">
          <path d={path} />
        </svg>
      ) : (
        monogram(label)
      )}
    </span>
  );
}
