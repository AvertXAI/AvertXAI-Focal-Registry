/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// What the Payroll tab works out from a person's payment rows. Kept apart from the view so the
// total can be checked against the Outstanding card's own source (reports.balanceFor) on a real
// database, without a window.

/**
 * The total under the payment list. Every row counts, reversals included: a reversal is a negative
 * row, so a payment and its reversal cancel here exactly as they do in the Outstanding card's
 * "paid", which is the same sum over the same rows.
 */
export function paidTotal(rows: readonly { amount: number }[]): number {
  const sum = rows.reduce((total, row) => total + row.amount, 0);
  // To the cent, because the card shows cents and adding one row at a time can leave float dust.
  // The + 0 turns a negative zero into zero, which would otherwise print as "-$0.00" when a
  // payment and its reversal are the only rows.
  return Math.round(sum * 100) / 100 + 0;
}

/**
 * The payments that have since been reversed. A reversal names the payment it took back, and it is
 * always written to the same person, so the list itself holds everything needed to tell.
 */
export function reversedUuids(rows: readonly { reverses_uuid: string | null }[]): Set<string> {
  const reversed = new Set<string>();
  for (const row of rows) if (row.reverses_uuid !== null) reversed.add(row.reverses_uuid);
  return reversed;
}
