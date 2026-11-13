/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: src/modules/vault/useLockWatch.ts */
// Keeps an open vault screen honest about the lock. Main can lock on its own (the idle limit) or
// through the other door, and it does not tell the page. Without this the screen goes on showing
// an open vault whose every read is refused, and the only way back to the lock screen is to leave
// the module.
import { useEffect } from "react";
import type { VaultApi, VaultLockState } from "./vaultApi";

// ponytail: asked every 30 seconds and whenever the window comes back, not pushed from main. The
// lock screen can therefore show up to 30 seconds after the idle limit. A push would be exact, but
// it means a new channel in two shell files for something that happens a few times a day.
const CHECK_MS = 30_000;

/** While `open`, asks main for the lock state and hands it to `onLocked` once it says locked. */
export function useLockWatch(api: VaultApi, open: boolean, onLocked: (state: VaultLockState) => void): void {
  useEffect(() => {
    if (!open) return;
    let stale = false;
    const check = (): void => {
      // The state read is not behind the lock and does not count as use, so asking can neither
      // fail because the vault locked nor keep it open.
      void api.lockState()
        .then((state) => { if (!stale && state.locked) onLocked(state); })
        .catch(() => undefined); // a vault that cannot answer is the next real read's problem to report
    };
    const timer = setInterval(check, CHECK_MS);
    window.addEventListener("focus", check);
    return () => {
      stale = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [api, open, onLocked]);
}
