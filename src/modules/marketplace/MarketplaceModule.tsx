/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Marketplace — coming-soon page (canon: its own module, own page, coming-soon until built; the
// plain explanatory statement, NEVER the orange glow). This page is the destination cap-hits will
// route to once a shell-level module nav hook exists (see the restructure report — separate task).
import { bumpRender } from "../../diag";

export default function MarketplaceModule() {
  bumpRender("marketplace"); // DIAG-2
  return (
    <main className="view shown">
      <div className="wrap">
        <h1 className="pagetitle">Marketplace</h1>
        <p className="subtitle">The Marketplace is coming soon.</p>
        <p>
          This is where Focal Registry&apos;s modules will live: browse the catalog, unlock paid
          modules by subscription, and manage what&apos;s active in your shell. Scan and Rename stay
          free; TimeTracker, Migrate, MindMerge, and Scout Viewer make up the paid layer.
        </p>
        <p>Until it opens, everything already installed keeps working exactly as it does today.</p>
      </div>
    </main>
  );
}
