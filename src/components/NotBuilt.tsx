/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Not-built page — what a seeded-but-unbuilt module row opens (§3.6). Plain statement, no orange
// glow: this product ships to a customer, so unbuilt is stated calmly, never advertised.
import { bumpRender } from "../diag";

export default function NotBuilt({ name }: { name?: string }) {
  bumpRender("not-built"); // DIAG-2
  return (
    <main className="view shown">
      <div className="wrap">
        <h1 className="pagetitle">{name ?? "Not built yet"}</h1>
        <p className="subtitle">This module has not been created yet. It will appear here once it is built.</p>
      </div>
    </main>
  );
}
