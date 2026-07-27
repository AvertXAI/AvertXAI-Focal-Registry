/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The tips REGISTRY — data, not JSX. One module-level source of truth; a later phase registers a
// new tip by adding ONE entry here and dropping <Tip id="…"/> on its surface. Id format:
// TIP-<MODULE>-<NNN>. Visibility is governed by the single tips.enabled setting (Jason ruled:
// all on or all off — no per-tip state).
export interface TipDef {
  id: string;
  module: string;
  title: string;
  body: string;
}

export const TIPS: TipDef[] = [
  {
    id: "TIP-MIG-001",
    module: "migrate",
    title: "Why settings files matter",
    body:
      "Brushes and actions that were merely loaded into Photoshop are often not saved as files at all — they live inside Brushes.psp and Actions Palette.psp. Leave that type unticked and a machine with hundreds of brushes can come back empty.",
  },
  {
    id: "TIP-MIG-002",
    module: "migrate",
    title: "Files that shipped with the application",
    body:
      "Assets found inside a Program Files Adobe install are left unticked because the new machine already has them.",
  },
];

export const tipById = (id: string): TipDef | undefined => TIPS.find((t) => t.id === id);
