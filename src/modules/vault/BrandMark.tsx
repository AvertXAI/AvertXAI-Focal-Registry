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
//
// THREE TIERS, IN THIS ORDER, AND THE ORDER IS THE POINT:
//   1. the vendored set (modules/vault/assets/brand-icons) — ~90 marks, hand-picked, bundled
//   2. the brand pack (brand://icon/<domain>) — ~1,170 site favicons, downloaded
//   3. brand colour + initials
// Curated beats downloaded because tier 1 is a chosen SVG and tier 2 is whatever the site serves as
// its favicon. Tier 2 exists to fill the long tail, not to replace tier 1. Every tier degrades into
// the next on a load error, so a pack that has not arrived looks exactly like the app did before it.
import { useEffect, useState } from "react";
import { brandColour, iconFile, inkFor, monogram } from "./brandTile";
import { iconUrl, loadBrandPack, onBrandPackReady } from "./brandPack";

export default function BrandMark({ label, size = 34 }: { label: string; size?: number }) {
  // A file that fails to load must fall back, not leave a hole — hence the error flags rather than
  // trusting the manifest to always match what shipped.
  const [bundledFailed, setBundledFailed] = useState(false);
  const [packFailed, setPackFailed] = useState(false);
  // The map arrives asynchronously; re-render when it lands so tiles fill in without a reload.
  const [, bump] = useState(0);

  useEffect(() => {
    void loadBrandPack();
    return onBrandPackReady(() => bump((n) => n + 1));
  }, []);

  // The label can change on the same mounted tile (list virtualisation reuses rows), so a previous
  // entry's load failure must not blank out the next one.
  useEffect(() => {
    setBundledFailed(false);
    setPackFailed(false);
  }, [label]);

  const bundled = bundledFailed ? null : iconFile(label);
  const packed = bundled || packFailed ? null : iconUrl(label);
  const src = bundled ?? packed;

  const fell = (): void => (bundled ? setBundledFailed(true) : setPackFailed(true));

  if (src) {
    return (
      <span className="vault-mark vault-mark-icon" style={{ width: size, height: size }}>
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          // onError ALONE IS NOT ENOUGH. A refusal that resolves synchronously — a Content Security
          // Policy miss is the one that bit us — fires error before React has attached this handler,
          // and the tile then keeps a broken-image glyph forever instead of falling back. The ref
          // catches that case: an <img> that is `complete` with zero natural width has already
          // failed, whether or not anyone heard it.
          ref={(el) => {
            if (el && el.complete && el.naturalWidth === 0) fell();
          }}
          onError={fell}
        />
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
