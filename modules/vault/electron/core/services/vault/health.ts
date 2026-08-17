// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Password health. THE STRUCTURAL POINT: the analysis runs MAIN-SIDE, beside the
//              data, and only VERDICTS cross the bridge — a score, three booleans and plain
//              sentences. The renderer never receives the values it was computed from, so the
//              "one logged read" rule survives a feature that by its nature must look at every
//              password at once. Reuse is detected by comparing SHA-256 digests in memory rather
//              than the values themselves; the digests never leave this function either.
//              Thresholds are SETTINGS, never constants (health.stale_days, health.min_length), so
//              "old" can be retuned without a build. Electron-free.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/vault/health.ts
//------------------------------------------------------------
import crypto from "node:crypto";
import type { Db } from "./db";
import { estimateStrength } from "./generator";
import { getNumber } from "./settings";
import { readAllForAnalysis } from "./store";
import type { VaultHealthItem, VaultHealthReport } from "./types";

function ageInDays(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * Scores every active secret. `caller` is stamped by the boundary and the CALLER logs the scan —
 * this file never writes, which is what keeps "the log has one writer" true.
 */
export function analyseHealth(db: Db, orgId: string): VaultHealthReport {
  const staleDays = getNumber(db, orgId, "health.stale_days");
  const minLength = getNumber(db, orgId, "health.min_length");
  const rows = readAllForAnalysis(db, orgId);

  // Reuse: count digests, never values. Two entries sharing a password are BOTH flagged — telling
  // the user only about the second one would hide half the problem.
  const digestCounts = new Map<string, number>();
  for (const r of rows) {
    const d = crypto.createHash("sha256").update(r.value).digest("hex");
    digestCounts.set(d, (digestCounts.get(d) ?? 0) + 1);
  }

  const items: VaultHealthItem[] = rows.map((r) => {
    const strength = estimateStrength(r.value);
    const digest = crypto.createHash("sha256").update(r.value).digest("hex");
    const reused = (digestCounts.get(digest) ?? 0) > 1;
    const days = ageInDays(r.created_at);
    const stale = days !== null && days > staleDays;
    const weak = strength.level <= 1 || r.value.length < minLength;

    // Plain sentences a photographer can act on. NEVER the password, never a fragment of it.
    const reasons: string[] = [];
    if (strength.level <= 1) reasons.push(`Guessable in about ${strength.crackTime}.`);
    if (r.value.length < minLength) reasons.push(`Only ${r.value.length} characters — ${minLength} is the minimum here.`);
    if (reused) reasons.push("The same password is used on another entry.");
    if (stale && days !== null) reasons.push(`Last changed ${days} days ago.`);
    if (reasons.length === 0) reasons.push("Strong and unique.");

    // One headline number per entry: strength is the spine, reuse and age are flat deductions.
    let score = Math.min(100, Math.round((strength.bits / 80) * 100));
    if (reused) score -= 30;
    if (stale) score -= 15;
    score = Math.max(0, Math.min(100, score));

    return { uuid: r.uuid, label: r.label, username: r.username, score, weak, reused, ageDays: days, stale, reasons };
  });

  const weak = items.filter((i) => i.weak).length;
  const reused = items.filter((i) => i.reused).length;
  const stale = items.filter((i) => i.stale).length;
  const healthy = items.filter((i) => !i.weak && !i.reused && !i.stale).length;
  const score = items.length === 0 ? 100 : Math.round(items.reduce((s, i) => s + i.score, 0) / items.length);

  // Worst first — the list exists to be worked down, not browsed.
  items.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label));
  return { total: items.length, healthy, weak, reused, stale, score, items };
}
