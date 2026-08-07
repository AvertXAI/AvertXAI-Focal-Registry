/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// ONE tile mark, used by every view — collage, three-pane, folder tree and list. Because all four
// call this, dropping real icon artwork in later (brandTile.iconPathFor) lights up every surface at
// once instead of four separate edits that drift.
import { brandColour, brandSvg, iconPathFor, inkFor, monogram } from "./brandTile";

export default function BrandMark({ label, size = 34 }: { label: string; size?: number }) {
  const svg = brandSvg(label);
  // A real full-colour icon brings its own colours, so it sits on a neutral plate rather than the
  // brand colour — painting a coloured logo onto its own colour makes it disappear.
  if (svg) {
    return (
      <span
        className="vault-mark vault-mark-icon"
        style={{ width: size, height: size }}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }
  const colour = brandColour(label);
  const path = iconPathFor(label);
  return (
    <span
      className="vault-mark"
      style={{ background: colour, color: inkFor(colour), width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {path ? (
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} fill="currentColor">
          <path d={path} />
        </svg>
      ) : (
        monogram(label)
      )}
    </span>
  );
}
