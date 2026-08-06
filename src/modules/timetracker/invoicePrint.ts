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

export const INVOICE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
    color: #111; font-size: 10.5pt; line-height: 1.45;
    font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22pt; }
  .biz .name { font-size: 16pt; font-weight: 700; letter-spacing: 0.2pt; }
  .biz .meta { color: #444; font-size: 9.5pt; margin-top: 3pt; }
  .stamp { text-align: right; }
  .stamp .word { font-size: 20pt; font-weight: 700; letter-spacing: 3pt; color: #111; }
  .stamp .num { font-size: 11pt; margin-top: 3pt; }
  .stamp .date { color: #444; font-size: 9.5pt; margin-top: 2pt; }
  .parties { display: flex; gap: 36pt; margin-bottom: 20pt; }
  .party .label { font-size: 8pt; letter-spacing: 1.5pt; text-transform: uppercase; color: #666; font-weight: 700; margin-bottom: 3pt; }
  .party .who { font-weight: 600; }
  .party .meta { color: #444; font-size: 9.5pt; }
  table.lines { width: 100%; border-collapse: collapse; margin-bottom: 14pt; }
  table.lines th {
    font-size: 8pt; letter-spacing: 1.2pt; text-transform: uppercase; color: #444; font-weight: 700;
    text-align: left; padding: 5pt 6pt; border-bottom: 1.5pt solid #111;
  }
  table.lines td { padding: 6pt; border-bottom: 0.75pt solid #ccc; vertical-align: top; }
  th.desc, td.desc { width: 50%; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  .totals { display: flex; justify-content: flex-end; margin-bottom: 20pt; }
  .totals table { border-collapse: collapse; min-width: 220pt; }
  .totals td { padding: 3.5pt 6pt; text-align: right; }
  .totals td.k { color: #444; }
  .totals tr.total td { border-top: 1pt solid #111; font-weight: 600; }
  .totals tr.due td { font-size: 14pt; font-weight: 700; padding-top: 6pt; }
  .footblock { display: flex; gap: 36pt; border-top: 0.75pt solid #ccc; padding-top: 12pt; }
  .footblock .label { font-size: 8pt; letter-spacing: 1.5pt; text-transform: uppercase; color: #666; font-weight: 700; margin-bottom: 3pt; }
  .footblock .body { color: #333; font-size: 9.5pt; }
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
      <div class="name">${esc(inv.business.name || "—")}</div>
      <div class="meta">${bizMeta}</div>
    </div>
    <div class="stamp">
      <div class="word">INVOICE</div>
      <div class="num">${esc(inv.number)}</div>
      <div class="date">Issued ${dateFmt(inv.invoice_date)}${inv.completed_at ? ` · Job completed ${dateFmt(inv.completed_at)}` : ""}</div>
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
  </div>`;
}
