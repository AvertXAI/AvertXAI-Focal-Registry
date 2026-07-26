/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// <Tip id="TIP-XXX-NNN"/> — the ONE hint surface. Looks the id up in the shared registry
// (src/shared/tips.ts), renders NOTHING when tips.enabled is off, renders nothing (plus one
// console warning) for an unknown id. Enabled state lives in app_settings ("tips.enabled",
// default TRUE) — warmed at App boot, flipped live by the Settings switch, NEVER localStorage.
import { useSyncExternalStore } from "react";
import { tipById } from "../shared/tips";

// Module-scope store: one boolean, every mounted <Tip> re-renders on change.
let enabled = true;
const subs = new Set<() => void>();
const emit = (): void => subs.forEach((f) => f());
const subscribe = (cb: () => void): (() => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};
const getSnapshot = (): boolean => enabled;

/** Flip live (Settings switch calls this alongside persisting the setting). */
export function setTipsEnabled(v: boolean): void {
  enabled = v;
  emit();
}
export function getTipsEnabled(): boolean {
  return enabled;
}
/** Warm from app_settings at App boot — default TRUE (absent key = on). */
export function warmTipsEnabled(): Promise<void> {
  return window.api.settings
    .get("tips.enabled")
    .then((v) => {
      enabled = v !== "0";
      emit();
    })
    .catch(() => {});
}

const warned = new Set<string>(); // one console warning per unknown id, not one per render

export default function Tip({ id }: { id: string }) {
  const on = useSyncExternalStore(subscribe, getSnapshot);
  const tip = tipById(id);
  if (!tip) {
    if (!warned.has(id)) {
      warned.add(id);
      console.warn(`[tips] unknown tip id: ${id}`);
    }
    return null;
  }
  if (!on) return null;
  // The tip id is a DEVELOPER handle (registry + reports), not user copy — deliberately not rendered.
  return (
    <aside className="tip">
      <div className="tip-head">{tip.title}</div>
      <p className="tip-body">{tip.body}</p>
    </aside>
  );
}
