/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
/* File: src/shared/vaultRules.ts */
// The master-password rules both sides have to agree on: main enforces them, the vault's screens
// say them. One file with no imports, so the number on screen can never drift from the number
// that is enforced, and so each rule can be tested without a database or a window.

/** The one minimum length: for the first master password and for every change after it. */
export const MASTER_PASSWORD_MIN = 12;

/**
 * How long an unlock try waits before it is checked, given the wrong tries in a row before it.
 *
 * The first three cost nothing, because a slip of the hand is not an attack. After that the wait
 * doubles from two seconds and stops at thirty: guessing gets slow, and the owner is never shut out.
 */
export function unlockDelayMs(failedAttempts: number): number {
  if (!(failedAttempts >= 3)) return 0;
  return Math.min(30_000, 2000 * 2 ** (failedAttempts - 3));
}
