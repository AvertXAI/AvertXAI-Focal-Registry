/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Cross-module navigation — the smallest honest addition, because nothing existed.
//
// WHAT THE 08-04 RECON ESTABLISHED: App owns the active view (`const [view, setView]`, App.tsx:162)
// and `select()` is private to it (App.tsx:338-342). Modules are mounted as `<ActiveModule />` with
// NO PROPS at all (App.tsx:409) — MODULE_COMPONENTS is `Record<string, ComponentType>` (App.tsx:102).
// So a module cannot ask the shell to switch to another module, and cannot hand it anything.
//
// THE PATTERN IS THE HOUSE'S OWN, not an invention: App already uses a window CustomEvent for
// exactly this shape of problem — `UPDATE_TOAST_EVENT` at App.tsx:122-126, dispatched from anywhere
// and listened for inside the tree. This mirrors it. Alternatives were considered and rejected:
// adding props to MODULE_COMPONENTS changes the registry contract for every module (root lane, and
// far more surface than one button needs), and app_settings is for state that SURVIVES a restart —
// a navigation intent that outlived a relaunch would teleport the user on their next boot.
//
// The intent is a plain module-level variable, deliberately: it is read once, immediately, by the
// module that just mounted. That is the same lifetime as EmployeesModule's own `peopleCache` /
// `selectedCache` (EmployeesModule.tsx), so it is an established shape in this codebase. It is NOT
// localStorage and never touches it.

export const NAVIGATE_EVENT = "focal:navigate";

/** What a module wants the destination to open with. Consumed ONCE, then cleared. */
export interface NavIntent {
  /** Destination module slug — must match a MODULE_COMPONENTS key. */
  slug: string;
  /** Destination-defined: which tab to open. */
  tab?: string;
  /** Destination-defined: which record to preselect. */
  id?: number;
}

let pending: NavIntent | null = null;

/**
 * Switch modules, optionally carrying an intent. App listens and calls its own `select()`.
 * The intent is stashed BEFORE the event so the destination's mount effect can already read it.
 */
export function navigateToModule(intent: NavIntent): void {
  pending = intent;
  window.dispatchEvent(new CustomEvent<string>(NAVIGATE_EVENT, { detail: intent.slug }));
}

/**
 * Read and CLEAR the pending intent, if it is for this module. Consumed once by design: a stale
 * intent replayed on a later mount would drag the user somewhere they did not ask to go.
 */
export function takeNavIntent(slug: string): NavIntent | null {
  if (pending?.slug !== slug) return null;
  const intent = pending;
  pending = null;
  return intent;
}
