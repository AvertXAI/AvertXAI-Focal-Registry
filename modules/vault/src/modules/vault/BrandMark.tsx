/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// ONE tile mark, used by every view — collage, three-pane, folder tree and list. Because all four
// call this, widening the icon set lights up every surface at once.
//
// ⚠ WHY <img> AND NOT INLINE SVG. The first version inlined the markup with dangerouslySetInnerHTML
// and it was measurably wrong: upstream icons reuse the same class names and ids (.st0 across 8
// icons, id="a" across 15, id="Layer_1" across 7), so inlining them into one document let the last
// <style> win and made url(#a) gradients resolve against another icon's definition — logos rendered
// in each other's colours. An <img> gives every icon its own document and the collision cannot
// happen. It is also lazily loaded and cannot execute anything.
import { useState } from "react";
import { brandColour, iconFile, inkFor, monogram } from "./brandTile";

export default function BrandMark({ label, size = 34 }: { label: string; size?: number }) {
  // A file that fails to load must fall back, not leave a hole — hence the error flag rather than
  // trusting the manifest to always match what shipped.
  const [failed, setFailed] = useState(false);
  const file = failed ? null : iconFile(label);

  if (file) {
    return (
      <span className="vault-mark vault-mark-icon" style={{ width: size, height: size }}>
        <img src={file} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </span>
    );
  }
  const colour = brandColour(label);
  return (
    <span
      className="vault-mark"
      style={{ background: colour, color: inkFor(colour), width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {monogram(label)}
    </span>
  );
}
