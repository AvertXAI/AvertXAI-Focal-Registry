/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Employees input formatting — phone auto-dashing, social-security masking, the US state list, and
// the money/hours formatters the module's surfaces share.
//
// WRITTEN FRESH: the 08-04 recon confirmed NO input-formatting utility exists anywhere in src/
// (the three "mask" hits in the tree are the boot terminal overlay, unrelated). Kept deliberately
// small and local — this is presentation, not a trust boundary. The services validate what actually
// arrives (people.ts clean()), and they store what the user typed.

/** All fifty states plus DC — the fixed list behind the State select. Two-letter codes are what the
    schema stores (vNullableState), so the value and the label are the same string. */
export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR",
  "PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
] as const;

/**
 * Phone — "dashes add themselves" (mockup v5:162). Digits only are kept, then grouped 3-3-4 as the
 * user types. Anything past ten digits is dropped rather than appended: a US number has ten, and
 * silently accepting an eleventh produces a value no one can dial.
 * Deliberately NOT a validator — the field stays free text in the database (phone TEXT), and this
 * only shapes what the user sees while typing.
 */
export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Social security — grouped 3-2-4 while typing. Same "store what was typed" rule as the phone:
 * this shapes the display, and the service stores the string as given (people.ts) because an
 * identifier that gets silently reformatted is an identifier that stops matching a tax form.
 */
export function formatSsn(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/** The blurred form: ∙∙∙-∙∙-∙∙∙∙ (mockup v5:179). Shape only — it reveals nothing, and an empty
    value stays empty rather than showing a mask over nothing. */
export const SSN_MASK = "∙∙∙-∙∙-∙∙∙∙";
export const maskSsn = (value: string): string => (value.trim() === "" ? "" : SSN_MASK);

/**
 * A bare rate number means dollars (ruled): "15" → "15.00". Runs on BLUR, never per keystroke —
 * normalizing while typing would fight the user the moment they type a decimal point.
 * A value that is not a usable number is returned untouched so the form can flag it rather than
 * silently replacing what someone typed.
 */
export function normalizeMoney(raw: string): string {
  const s = raw.trim();
  if (s === "") return "";
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : raw;
}

export const fmtMoney = (n: number): string =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 6.25 → "6h 15m". Display only; the decimal is what is stored and what the money maths uses. */
export function fmtHoursHuman(h: number): string {
  const whole = Math.floor(h);
  return `${whole}h ${String(Math.round((h - whole) * 60)).padStart(2, "0")}m`;
}

/** worked_on is a plain YYYY-MM-DD — parsed as LOCAL, never through Date's UTC-shifting path. */
export function fmtDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ymd;
}

/** Local YYYY-MM-DD for today — never toISOString(), which shifts to UTC and can hand back yesterday. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The pay-type pill, in canon order. Shared by the person form and Add Time so the two can never
    drift into offering different sets. */
export const PAY_TYPE_PILLS = [
  ["hourly", "hourly"],
  ["job", "job"],
  ["task", "task"],
  ["donated", "donated"],
] as const;

/** The rate label follows the selected pill: $ / hour · $ / job · $ / task · $ / donated. */
export const rateSuffix = (payType: string): string =>
  payType === "hourly" ? "/ hour" : payType === "job" ? "/ job" : payType === "task" ? "/ task" : "/ donated";
