// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: THE clipboard funnel for the vault — every copy in the module goes through here so
//              the "Clear clipboard after N seconds" setting is a fact, not a claim. Shipped for
//              weeks as a dropdown with ZERO readers: all the copy sites called
//              navigator.clipboard.writeText directly and nothing ever cleared
//              (vault-broken-patch.md Tier-1 item 1 — "the product lies").
//
//              WHY MAIN-SIDE and not a renderer helper: the deferred clear must READ the clipboard
//              to honour the one rule that matters — never clobber something the user copied later
//              — and navigator.clipboard.readText() rejects whenever the window is unfocused.
//              The user has ALWAYS switched away by the time the timer fires; that is what pasting
//              a password is. Electron's main-process clipboard has no focus rule, and main-side
//              is also where the setting lives, so "read clear_seconds live" costs one SELECT.
//
//              Ports are injected so the proof harness can drive the timer by hand under
//              ELECTRON_RUN_AS_NODE, where require("electron") is not the real module.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/clipboard.ts
//------------------------------------------------------------

/** What the helper needs from a clipboard. Electron's main `clipboard` satisfies it directly. */
export interface ClipboardPort {
  read(): string;
  write(text: string): void;
  clear(): void;
}

/** What it needs from time. Prod is setTimeout/clearTimeout; the proof fires the callback itself. */
export interface ClockPort {
  set(fn: () => void, ms: number): unknown;
  clear(timer: unknown): void;
}

/**
 * ONE pending clear at a time, module-wide. A second copy before the first clear fires must cancel
 * the first timer — otherwise copy A, copy B, then A's timer fires, sees B (not A), skips the
 * clear, and B lives on the clipboard forever while the user believes it was wiped.
 */
let pending: unknown = null;
let pendingClock: ClockPort | null = null;

/**
 * Copy `value`, then clear the clipboard after `seconds` — but ONLY if the clipboard still holds
 * `value` when the timer fires. A later copy by the user (from anywhere: a browser, a document)
 * is theirs; wiping it would turn a safety feature into data loss. `seconds <= 0` means never —
 * the setting's documented "0" contract.
 */
export function copyWithClear(value: string, seconds: number, clip: ClipboardPort, clock: ClockPort): void {
  clip.write(value);
  if (pending !== null && pendingClock) pendingClock.clear(pending);
  pending = null;
  if (!(seconds > 0)) return; // catches 0, negatives, and NaN in one comparison
  pendingClock = clock;
  pending = clock.set(() => {
    pending = null;
    // A clipboard read can throw (another process holding it open on Windows). A failed clear must
    // never take the app down from inside a timer — worst case the value outlives its window,
    // which is exactly where the product stood before this file existed.
    try {
      if (clip.read() === value) clip.clear();
    } catch {
      /* leave it */
    }
  }, seconds * 1000);
}

/** Proof-harness reset so one check's armed timer cannot leak into the next check's assertions. */
export function _resetForTest(): void {
  if (pending !== null && pendingClock) pendingClock.clear(pending);
  pending = null;
  pendingClock = null;
}
