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
  {
    id: "TIP-TT-001",
    module: "timetracker",
    title: "Timers keep running in the background",
    body:
      "A running timer lives in the app itself, not this screen — navigate to any other module, or minimize the window, and the clock keeps counting until you stop it.",
  },
  {
    id: "TIP-TT-002",
    module: "timetracker",
    title: "Adjustments never touch your sessions",
    body:
      "An adjustment is its own auditable record — the tracked sessions underneath are never modified. Deleting one is a soft delete: it stops counting, but the row and its full history stay visible, struck through.",
  },
  {
    id: "TIP-TT-003",
    module: "timetracker",
    title: "The value ledger never forgets",
    body:
      "Setting a new amount appends a row that carries the previous value with it — nothing is edited, nothing is deleted. That running history is the point: you can watch what a project was worth grow over time.",
  },
  {
    id: "TIP-TT-004",
    module: "timetracker",
    title: "Your analytics never leave this machine",
    body:
      "Export PDF prints this page straight to your Downloads folder using the app itself — no service, no upload, no account. The numbers in the file are exactly the numbers on this screen.",
  },
  {
    id: "TIP-TT-005",
    module: "timetracker",
    title: "Licence keys are checked offline",
    body:
      "Keys are validated inside the app, offline. Entering one unlocks higher caps; without one, the Free tier keeps working.",
  },
  {
    id: "TIP-TT-006",
    module: "timetracker",
    title: "Closing the mini timer stops nothing",
    body:
      "The floating strip is just a window onto your timers — close it, move it, or forget it, and every clock keeps counting in the app. Click a row in it to pause that one timer; click again to resume.",
  },
];

export const tipById = (id: string): TipDef | undefined => TIPS.find((t) => t.id === id);
