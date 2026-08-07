/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// INVOICE print document — a DEDICATED print renderer + stylesheet (the scan/reportPrint.ts
// doctrine: the on-screen view and the PDF can never silently change each other). Composes the
// main-side TimeTrackerInvoiceData into a self-contained HTML document that the hidden sandboxed
// window prints to US Letter.
//
// LAYOUT LAW (the avertxai-invoice-pdf skill's non-negotiables, applied to HTML because the house
// PDF machinery renders HTML — recorded in the build report): Inter / IBM Plex Sans with TABULAR
// LINING FIGURES (font-variant-numeric + "tnum" fallback for Segoe UI); line table is
// description 50% / qty / rate / amount with every numeric column right-aligned; totals stack
// bottom-right ending in BALANCE DUE as the largest number on the page; sales tax separately
// stated with rate AND amount; two decimals everywhere; grayscale-safe (black and grays only).
// A Deposit line renders ONLY when a value exists — there is no client-payments model in this
// build, so none does.
import type { TimeTrackerInvoiceData } from "../../shared/types";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const qtyFmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Month-first, the house date rule. */
const dateFmt = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
};

/** Multi-line free text (addresses, payment methods, terms) → escaped lines. */
const lines = (s: string): string => esc(s).split(/\r?\n/).filter(Boolean).join("<br>");

// The export handler prepends an @font-face for the BUNDLED Inter variable font (assets/fonts/,
// SIL OFL — skill §3's approved list) as a data URI, so the face is EMBEDDED in the PDF (§2) on
// every machine. The stacks below fall through to the other approved families only if that load
// ever fails. Spacing sits on the skill's 8-point system (4 as the half step); sizes per §3.
export const INVOICE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, "IBM Plex Sans", "Source Sans 3", Roboto, sans-serif;
    color: #111; font-size: 10.5pt; line-height: 1.35; /* §3: 1.3–1.4×; relative so headings scale */
    font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24pt; }
  .biz { display: flex; gap: 12pt; align-items: flex-start; }
  .logo { max-height: 72pt; max-width: 144pt; }
  .biz .name { font-size: 18pt; font-weight: 700; letter-spacing: 0.2pt; }
  .biz .meta { color: #444; font-size: 9.5pt; margin-top: 4pt; }
  .stamp { text-align: right; }
  .stamp .word { font-size: 20pt; font-weight: 700; letter-spacing: 3pt; color: #111; }
  .stamp .num { font-size: 11pt; margin-top: 4pt; }
  .stamp .date { color: #444; font-size: 9.5pt; margin-top: 2pt; }
  .parties { display: flex; gap: 32pt; margin-bottom: 24pt; }
  .party .label { font-size: 8pt; letter-spacing: 1.5pt; text-transform: uppercase; color: #666; font-weight: 700; margin-bottom: 4pt; }
  .party .who { font-weight: 600; }
  .party .meta { color: #444; font-size: 9.5pt; }
  table.lines { width: 100%; border-collapse: collapse; margin-bottom: 16pt; }
  table.lines thead { display: table-header-group; } /* header row REPEATS on every page (skill §5.4) */
  table.lines th {
    font-size: 9pt; letter-spacing: 1.2pt; text-transform: uppercase; color: #444; font-weight: 700;
    text-align: left; padding: 4pt 8pt; border-bottom: 1.5pt solid #111;
  }
  table.lines td { padding: 8pt; border-bottom: 0.75pt solid #ccc; vertical-align: top; }
  th.desc, td.desc { width: 50%; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  .totals { display: flex; justify-content: flex-end; margin-bottom: 24pt; break-inside: avoid; }
  .totals table { border-collapse: collapse; min-width: 224pt; }
  .totals td { padding: 4pt 8pt; text-align: right; }
  .totals td.k { color: #444; }
  .totals tr.total td { border-top: 1pt solid #111; font-weight: 600; }
  .totals tr.due td { font-size: 14pt; font-weight: 700; padding-top: 8pt; }
  .footblock { display: flex; gap: 32pt; border-top: 0.75pt solid #ccc; padding-top: 12pt; break-inside: avoid; }
  .footblock .label { font-size: 8pt; letter-spacing: 1.5pt; text-transform: uppercase; color: #666; font-weight: 700; margin-bottom: 4pt; }
  .footblock .body { color: #333; font-size: 9.5pt; }
  .thanks { color: #444; font-size: 9.5pt; margin-top: 12pt; }
`;

export function renderInvoiceHtml(inv: TimeTrackerInvoiceData): string {
  const rows = inv.lines
    .map(
      (l) => `<tr>
        <td class="desc">${esc(l.description)}</td>
        <td class="num">${qtyFmt(l.qty)}</td>
        <td class="num">${money(l.rate)}</td>
        <td class="num">${money(l.amount)}</td>
      </tr>`
    )
    .join("");

  const bizMeta = [lines(inv.business.address), esc([inv.business.phone, inv.business.email].filter(Boolean).join(" · ")), esc(inv.business.website)]
    .filter(Boolean)
    .join("<br>");
  const clientMeta = [
    inv.client.company ? esc(inv.client.company) : "",
    lines(inv.client.address),
    esc([inv.client.phone, inv.client.email].filter(Boolean).join(" · ")),
  ]
    .filter(Boolean)
    .join("<br>");
  const serviced =
    inv.service_dates.first || inv.service_dates.last
      ? `${dateFmt(inv.service_dates.first)} – ${dateFmt(inv.service_dates.last)}`
      : "—";

  return `
  <div class="head">
    <div class="biz">
      ${inv.logo_data_uri ? `<img class="logo" src="${inv.logo_data_uri}" alt="">` : ""}
      <div>
        <div class="name">${esc(inv.business.name || "—")}</div>
        <div class="meta">${bizMeta}</div>
      </div>
    </div>
    <div class="stamp">
      <div class="word">INVOICE</div>
      <div class="num">${esc(inv.number)}</div>
      <div class="date">Issued ${dateFmt(inv.invoice_date)}</div>
      <div class="date">Due ${inv.due_date ? dateFmt(inv.due_date) : "on receipt"}</div>
      ${inv.completed_at ? `<div class="date">Job completed ${dateFmt(inv.completed_at)}</div>` : ""}
    </div>
  </div>
  <div class="parties">
    <div class="party">
      <div class="label">Bill to</div>
      <div class="who">${esc(inv.client.name)}</div>
      <div class="meta">${clientMeta}</div>
    </div>
    <div class="party">
      <div class="label">Project</div>
      <div class="who">${esc(inv.project_name)}</div>
      <div class="meta">Dates of service: ${serviced}</div>
    </div>
  </div>
  <table class="lines">
    <thead><tr><th class="desc">Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <table>
      <tr><td class="k">Subtotal</td><td>${money(inv.subtotal)}</td></tr>
      <tr><td class="k">Sales tax (${inv.tax_rate.toFixed(2)}%)</td><td>${money(inv.tax_amount)}</td></tr>
      <tr class="total"><td class="k">Total</td><td>${money(inv.total)}</td></tr>
      <tr class="due"><td class="k">Balance Due</td><td>${money(inv.balance_due)}</td></tr>
    </table>
  </div>
  <div class="footblock">
    ${inv.business.payment_methods ? `<div><div class="label">Payment</div><div class="body">${lines(inv.business.payment_methods)}</div></div>` : ""}
    ${inv.business.terms ? `<div><div class="label">Terms</div><div class="body">${lines(inv.business.terms)}</div></div>` : ""}
  </div>
  <p class="thanks">Thank you for your business.</p>`;
}
