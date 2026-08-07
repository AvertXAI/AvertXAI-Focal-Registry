// -----------------------------------------------------------
// Author: Jason Cruz
// Copyright: (c) 2026 AvertXAI. All Rights Reserved.
// Project: AvertXAI Focal Registry
// Description: Invoice DATA for a completed job — the number and every field the renderer's
//              invoice document composes. Numbering is INV-YYYY-NNNN, sequential PER YEAR,
//              allocated the FIRST time an invoice is exported for a project and stored on the
//              project row so a re-export reproduces the same number forever (ruled 08-06-2026).
//              Reactivate → complete does NOT re-allocate.
//
//              LINE COMPOSITION (recorded in the build report — the avertxai-invoice-pdf skill
//              file was NOT FOUND; the prompt's non-negotiables govern layout and this file's
//              composition is the minimal honest reading of the ruled inputs): the primary
//              service line bills what the client agreed to (contract amount, or hours × hourly
//              rate), followed by the project's live itemized rows (qty × unit rate = amount;
//              legacy rows derive rate as amount ÷ qty). Tax is the Business Profile's default
//              rate, separately stated. There is NO client-payments model in this build (ruled
//              out of scope) — no Deposit line renders and Balance Due equals the total.
// License: Proprietary / Unauthorized copying of this file is strictly prohibited
// File: electron/core/services/timetracker/invoice.ts
//------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { getSetting } from "../settings";
import { nowIso, type Db } from "./db";
import { getProject } from "./projects";
import { totalFor as paymentsTotalFor } from "./payments";
import type { InvoiceData, InvoiceLine } from "./types";
import { vId } from "./validate";

/** INV-YYYY-NNNN. The year is the COMPLETION year when completed, else the current year. */
function nextNumberFor(db: Db, year: number): string {
  const prefix = `INV-${year}-`;
  const row = db
    .prepare(
      `SELECT invoice_number FROM timetracker_projects
       WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1`
    )
    .get(`${prefix}%`) as { invoice_number: string } | undefined;
  const last = row ? Number.parseInt(row.invoice_number.slice(prefix.length), 10) : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

/** Returns the project's invoice number, allocating and storing it on first call. Transactional so
    two racing exports cannot mint the same number. */
export function allocateInvoiceNumber(db: Db, projectId: number): string {
  const id = vId(projectId, "project id");
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT invoice_number, completed_at FROM timetracker_projects WHERE id = ?`)
      .get(id) as { invoice_number: string | null; completed_at: string | null } | undefined;
    if (!row) throw new Error(`Project ${id} not found`);
    if (row.invoice_number) return row.invoice_number;
    const year = new Date(row.completed_at ?? nowIso()).getFullYear();
    const num = nextNumberFor(db, year);
    db.prepare(`UPDATE timetracker_projects SET invoice_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      num,
      id
    );
    return num;
  })();
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Due date from the profile's terms (skill §5.2/§6: an invoice carries one): "Net 30" → invoice
    date + 30 days; anything else (or nothing) → null, which the document prints as "Due on receipt". */
function dueDateFrom(terms: string, invoiceIso: string): string | null {
  const m = /net\s*(\d{1,3})/i.exec(terms);
  if (!m) return null;
  const d = new Date(invoiceIso);
  d.setDate(d.getDate() + Number(m[1]));
  return d.toISOString();
}

/** The stored logo as an embedded data URI (skill §2: embed, never link) — null when unset,
    unreadable, or not a printable raster format. Read via Node fs, so an asar path also works. */
function logoDataUri(logoPath: string): string | null {
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }[
    path.extname(logoPath).toLowerCase()
  ];
  if (!mime) return null;
  try {
    return `data:${mime};base64,${fs.readFileSync(logoPath).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Everything the invoice document needs, in one read. Allocates the number as a side effect —
    this is the "first exported" moment the ruling names. */
export function invoiceData(db: Db, _orgId: string, projectId: number): InvoiceData {
  const id = vId(projectId, "project id");
  const project = getProject(db, id); // throws if missing; carries client + rollups via LIST_SQL
  const number = allocateInvoiceNumber(db, id);

  const client = db
    .prepare(`SELECT name, company, address, contact_phone, email FROM timetracker_clients WHERE id = ?`)
    .get(project.client_id) as {
    name: string;
    company: string | null;
    address: string | null;
    contact_phone: string | null;
    email: string | null;
  };

  const lines: InvoiceLine[] = [];
  const hours = project.total_seconds / 3600;
  // The primary service line — what the client agreed to pay.
  if (project.rate_type === "contract") {
    const amount = project.contract_kind === "paid" ? (project.contract_amount ?? 0) : 0;
    lines.push({
      description:
        (project.contract_description?.trim() || `${project.name} — photography services`) +
        (project.contract_kind === "donated" ? " (donated)" : ""),
      qty: 1,
      rate: round2(amount),
      amount: round2(amount),
    });
  } else {
    const rate = project.hourly_rate ?? 0;
    lines.push({
      description: `${project.name} — photography services (${hours.toFixed(2)} hours)`,
      qty: round2(hours),
      rate: round2(rate),
      amount: round2(hours * rate),
    });
  }
  // The project's live itemized rows. Legacy rows (no unit_rate) derive rate = amount ÷ qty.
  const items = db
    .prepare(
      `SELECT qty, description, amount, unit_rate FROM timetracker_project_items
       WHERE project_id = ? AND deleted_at IS NULL ORDER BY id ASC`
    )
    .all(id) as { qty: number; description: string; amount: number; unit_rate: number | null }[];
  for (const it of items) {
    lines.push({
      description: it.description,
      qty: it.qty,
      rate: round2(it.unit_rate ?? (it.qty > 0 ? it.amount / it.qty : it.amount)),
      amount: round2(it.amount),
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxRateRaw = Number.parseFloat(getSetting("business.tax_rate") ?? "");
  const taxRate = Number.isFinite(taxRateRaw) && taxRateRaw > 0 ? taxRateRaw : 0;
  const taxAmount = round2(subtotal * (taxRate / 100));
  // DEPOSIT from REAL payment rows (08-06 — the payments model closed this gap). Shown negative in
  // the totals stack per the skill (§5.5); Balance Due is what is still owed.
  const deposit = round2(paymentsTotalFor(db, id));
  const total = round2(subtotal + taxAmount);

  const invoiceDate = nowIso();
  const terms = getSetting("business.terms") ?? "";
  const logoPath = getSetting("business.logo_path") ?? "";
  return {
    number,
    invoice_date: invoiceDate,
    due_date: dueDateFrom(terms, invoiceDate),
    completed_at: project.completed_at ?? null,
    logo_data_uri: logoPath.trim() ? logoDataUri(logoPath.trim()) : null,
    business: {
      name: getSetting("business.name") ?? "",
      address: getSetting("business.address") ?? "",
      phone: getSetting("business.phone") ?? "",
      email: getSetting("business.email") ?? "",
      website: getSetting("business.website") ?? "",
      payment_methods: getSetting("business.payment_methods") ?? "",
      terms: getSetting("business.terms") ?? "",
    },
    client: {
      name: client.name,
      company: client.company ?? "",
      address: client.address ?? "",
      phone: (client.contact_phone ?? "") + (project.phone_ext ? ` x${project.phone_ext}` : ""),
      email: client.email ?? "",
    },
    project_name: project.name,
    service_dates: { first: project.created_at ?? null, last: project.last_worked ?? null },
    lines,
    subtotal,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    deposit_paid: deposit,
    total,
    balance_due: round2(Math.max(0, total - deposit)),
  };
}
