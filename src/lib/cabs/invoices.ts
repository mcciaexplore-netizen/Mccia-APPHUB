import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeCabAudit } from "./audit";
import type { InvoiceStatus } from "./cabs.manifest";
import { CabsError } from "./errors";
import type { CabUser } from "./host-adapter";
import { formatRupees } from "./money";

/**
 * Invoices: one per branch and period, for the costed, completed rides of that branch completed in the period that no invoice has billed
 * yet. Creating one claims those rides (cab_ride_costs.invoice_id) in the same statement, so a ride is billed once even when two invoices
 * are made at the same moment. draft → sent → paid; a draft can be deleted, which frees its rides again.
 */

type Actor = Pick<CabUser, "id" | "name">;
const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;

/** India's financial year (April to March) a day falls in, by the year it starts: 2026 for 1 Apr 2026 to 31 Mar 2027. */
export const financialYear = (d: Date) => {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
};

/** The prefix of this financial year's numbers: "CAB-2026-". */
export const invoicePrefix = (d: Date = new Date()) => `CAB-${financialYear(d)}-`;

/** The number after `last` in the same year: CAB-2026-0001, CAB-2026-0002, … (more digits after 9999). Independent of every other module. */
export function cabInvoiceNumber(last: string | null, d: Date = new Date()): string {
  const prefix = invoicePrefix(d);
  const n = last?.startsWith(prefix) ? Number(last.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(4, "0")}`;
}

export type InvoiceRow = {
  id: string; invoiceNumber: string; branch: string; periodStart: string; periodEnd: string; totalRides: number; totalAmountPaise: number; status: InvoiceStatus;
  notes: string | null; createdByName: string; createdAt: Date; paidAt: Date | null;
};

export async function listInvoices(): Promise<InvoiceRow[]> {
  return rows<Record<string, unknown>>(await db.execute(sql`
    select id, invoice_number, branch, period_start::text, period_end::text, total_rides, total_amount_paise, status, notes, created_by_name, created_at, paid_at
    from cab_invoices order by created_at desc limit 500`)).map((x) => ({
    id: String(x.id), invoiceNumber: String(x.invoice_number), branch: String(x.branch), periodStart: String(x.period_start), periodEnd: String(x.period_end),
    totalRides: Number(x.total_rides), totalAmountPaise: Number(x.total_amount_paise), status: x.status as InvoiceStatus, notes: (x.notes as string) ?? null,
    createdByName: String(x.created_by_name), createdAt: new Date(x.created_at as string), paidAt: x.paid_at ? new Date(x.paid_at as string) : null,
  }));
}

/**
 * Creates the invoice and claims its rides, in ONE statement. The number is the next in this financial year; if another invoice took it
 * at the same moment (the unique number refuses the second), it tries the next one.
 */
export async function createInvoice(v: { branch: string; periodStart: string; periodEnd: string; notes: string | null }, actor: Actor): Promise<{ id: string; invoiceNumber: string; totalRides: number; totalAmountPaise: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const [last] = rows<{ invoice_number: string }>(await db.execute(sql`
      select invoice_number from cab_invoices where invoice_number like ${`${invoicePrefix()}%`} order by length(invoice_number) desc, invoice_number desc limit 1`));
    const number = cabInvoiceNumber(last?.invoice_number ?? null);
    try {
      const [row] = rows<{ id: string; total_rides: number; total_amount_paise: number }>(await db.execute(sql`
        with eligible as (
          select c.id, c.base_fare_paise from cab_ride_costs c join cab_rides r on r.id = c.ride_id
          where c.invoice_id is null and r.status = 'completed' and r.requested_by_branch = ${v.branch}
            and (r.completed_at at time zone 'Asia/Kolkata')::date between ${v.periodStart}::date and ${v.periodEnd}::date
          for update of c),
        inv as (
          insert into cab_invoices (invoice_number, branch, period_start, period_end, total_rides, total_amount_paise, notes, created_by_id, created_by_name)
          select ${number}, ${v.branch}, ${v.periodStart}::date, ${v.periodEnd}::date, count(*), coalesce(sum(base_fare_paise), 0), ${v.notes}, ${actor.id}, ${actor.name}
          from eligible having count(*) > 0
          returning id, total_rides, total_amount_paise),
        claim as (update cab_ride_costs set invoice_id = (select id from inv) where id in (select id from eligible) and exists (select 1 from inv) returning 1)
        select inv.*, (select count(*) from claim)::int as claimed from inv`));
      if (!row) throw new CabsError(`No costed rides to invoice for ${v.branch} in that period (or they are all on an invoice already).`, 409);
      await writeCabAudit(actor, "invoice_created", { subject: number, details: { branch: v.branch, period: `${v.periodStart} to ${v.periodEnd}`, rides: Number(row.total_rides), total: formatRupees(Number(row.total_amount_paise)) } });
      return { id: row.id, invoiceNumber: number, totalRides: Number(row.total_rides), totalAmountPaise: Number(row.total_amount_paise) };
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code !== "23505") throw e; // the number was taken a moment ago: try the next one
    }
  }
  throw new CabsError("Could not number the invoice. Please try again.", 409);
}

/** draft → sent, sent → paid: each one conditional statement. */
export async function markInvoice(id: string, to: "sent" | "paid", actor: Actor): Promise<void> {
  const from = to === "sent" ? "draft" : "sent";
  const [row] = rows<{ invoice_number: string }>(await db.execute(sql`
    update cab_invoices set status = ${to}, paid_at = case when ${to} = 'paid' then now() else paid_at end
    where id = ${id} and status = ${from} returning invoice_number`));
  if (!row) {
    const [inv] = rows<{ status: string }>(await db.execute(sql`select status from cab_invoices where id = ${id}`));
    if (!inv) throw new CabsError("That invoice no longer exists. Reload and try again.", 404);
    throw new CabsError(`This invoice is ${inv.status}, so it can't be marked ${to}.`, 409);
  }
  await writeCabAudit(actor, to === "sent" ? "invoice_sent" : "invoice_paid", { subject: row.invoice_number });
}

/** Deletes a draft invoice; its rides are free to be invoiced again (their invoice_id is cleared by the foreign key). */
export async function deleteDraftInvoice(id: string, actor: Actor): Promise<void> {
  const [row] = rows<{ invoice_number: string }>(await db.execute(sql`delete from cab_invoices where id = ${id} and status = 'draft' returning invoice_number`));
  if (!row) {
    const [inv] = rows<{ status: string }>(await db.execute(sql`select status from cab_invoices where id = ${id}`));
    if (!inv) throw new CabsError("That invoice no longer exists. Reload and try again.", 404);
    throw new CabsError("Only a draft invoice can be deleted.", 409);
  }
  await writeCabAudit(actor, "invoice_deleted", { subject: row.invoice_number });
}
