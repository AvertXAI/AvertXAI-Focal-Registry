/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The WIDE mark, for surfaces that actually have width — currently the detail pane header.
//
// WHY THIS IS NOT JUST BrandMark WITH A BIGGER SIZE. The two asset sets are different shapes and
// are not interchangeable. Tiles are 26–44px squares and take a square icon; a wordmark forced into
// one becomes a ~34×8 strip that reads as a smudge. This component takes the wordmark, caps its
// HEIGHT and lets width run to its natural aspect, and falls back to the square tile when the pack
// has no wordmark for the vendor — which is the common case, so the fallback is the normal path,
// not the error path.
import { useEffect, useState } from "react";
import BrandMark from "./BrandMark";
import { loadBrandPack, logoUrl, onBrandPackReady } from "./brandPack";

export default function BrandLockup({ label, size = 38 }: { label: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const [, bump] = useState(0);

  useEffect(() => {
    void loadBrandPack();
    return onBrandPackReady(() => bump((n) => n + 1));
  }, []);

  // Virtualised panes reuse this node for a different entry; a stale failure must not blank it.
  useEffect(() => setFailed(false), [label]);

  const src = failed ? null : logoUrl(label);
  if (!src) return <BrandMark label={label} size={size} />;

  return (
    <span className="vault-mark-wordmark" style={{ display: "inline-flex", alignItems: "center", height: size }}>
      <img
        src={src}
        alt=""
        // Height-capped, width free: a wordmark's whole job is its aspect ratio. max-width stops a
        // very wide mark (some run 8:1) from shoving the header actions off the end.
        style={{ height: "100%", width: "auto", maxWidth: 190, objectFit: "contain" }}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
