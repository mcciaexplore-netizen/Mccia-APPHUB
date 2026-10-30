import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { inventoryMaintenanceTickets as t } from "@/db/inventory-schema";
import { writeAudit } from "@/lib/audit";
import { writeInventoryAudit } from "./audit";
import { InventoryError } from "./errors";
import type { InventoryUser } from "./host-adapter";

/**
 * Maintenance tickets: anyone reports a problem (with an optional photo); Inventory admins move it from open to in progress to resolved, with a
 * resolution note and photo. Photos are kept as data URLs in the ticket row and never read with the list: each is served on its own by
 * /api/inventory/maintenance/<id>/photo, to the person who raised it and to Inventory admins. Audited as inventory.ticket_raised /
 * ticket_updated / ticket_resolved.
 */

type Actor = Pick<InventoryUser, "id" | "name">;
const audit = (actor: Actor, action: string, id: string, label: string, details: Record<string, unknown> = {}) =>
  writeAudit(actor, [{ action: `inventory.${action}`, targetType: "system", targetId: id, targetLabel: label, details }]);

export type TicketStatus = "open" | "in_progress" | "resolved";
export type TicketRow = {
  id: string; title: string; note: string | null; location: string | null; status: TicketStatus; hasPhoto: boolean; raisedByUserId: string; raisedByName: string;
  raisedAt: Date; resolvedByName: string | null; resolvedAt: Date | null; resolutionNote: string | null; hasResolutionPhoto: boolean;
};

/** Everyone's tickets (Inventory admins) or only the person's own, open ones first. The photos themselves are not read here. */
export async function listTickets(f: { mineOnly?: string; status?: TicketStatus }): Promise<TicketRow[]> {
  const where: SQL[] = [];
  if (f.mineOnly) where.push(eq(t.raisedByUserId, f.mineOnly));
  if (f.status) where.push(eq(t.status, f.status));
  return db
    .select({
      id: t.id, title: t.title, note: t.note, location: t.location, status: t.status, hasPhoto: sql<boolean>`${t.photoUrl} is not null`,
      raisedByUserId: t.raisedByUserId, raisedByName: t.raisedByName, raisedAt: t.raisedAt, resolvedByName: t.resolvedByName, resolvedAt: t.resolvedAt,
      resolutionNote: t.resolutionNote, hasResolutionPhoto: sql<boolean>`${t.resolutionPhotoUrl} is not null`,
    })
    .from(t)
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`case ${t.status} when 'open' then 0 when 'in_progress' then 1 else 2 end`, desc(t.raisedAt))
    .limit(1000);
}

export async function ticketCounts(): Promise<Record<TicketStatus, number>> {
  const rows = await db.select({ status: t.status, n: sql<number>`count(*)`.mapWith(Number) }).from(t).groupBy(t.status);
  const out = { open: 0, in_progress: 0, resolved: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export async function createTicket(v: { title: string; description: string | null; location: string | null; photo: string | null }, actor: Actor) {
  const [row] = await db.insert(t).values({ title: v.title, note: v.description, location: v.location, photoUrl: v.photo, raisedByUserId: actor.id, raisedByName: actor.name })
    .returning({ id: t.id });
  await audit(actor, "ticket_raised", row.id, v.title, { location: v.location, photo: !!v.photo });
  await writeInventoryAudit(actor, "ticket_created", { targetType: "ticket", targetId: row.id, targetLabel: v.title, details: { title: v.title, reporter: actor.name, location: v.location } });
  return row;
}

/**
 * Moves a ticket on. Resolving records who and when; reopening (to open or in progress) clears that, keeping the note and photo.
 * The status it was in comes from the row locked inside the UPDATE itself, so the audit says what really changed.
 */
export async function updateTicket(id: string, v: { status: TicketStatus; resolutionNote: string | null; resolutionPhoto: string | null }, actor: Actor) {
  const res = (await db.execute(sql`
    update inventory_maintenance_tickets tk set
      status = ${v.status},
      resolution_note = ${v.resolutionNote},
      resolution_photo_url = coalesce(${v.resolutionPhoto}, tk.resolution_photo_url),
      resolved_by_user_id = case when ${v.status} = 'resolved' then case when old.status = 'resolved' then tk.resolved_by_user_id else ${actor.id}::uuid end end,
      resolved_by_name = case when ${v.status} = 'resolved' then case when old.status = 'resolved' then tk.resolved_by_name else ${actor.name} end end,
      resolved_at = case when ${v.status} = 'resolved' then case when old.status = 'resolved' then tk.resolved_at else now() end end
    from (select id, status, resolution_note from inventory_maintenance_tickets where id = ${id} for update) old
    where tk.id = old.id
    returning tk.title, old.status as was, old.resolution_note as old_note`)) as unknown as { rows: { title: string; was: TicketStatus; old_note: string | null }[] };
  const row = res.rows[0];
  if (!row) throw new InventoryError("That ticket no longer exists. Reload and try again.", 404);
  const changes = { from: row.was, to: v.status, note: row.old_note !== v.resolutionNote, photo: !!v.resolutionPhoto };
  if (row.was !== v.status || changes.note || changes.photo) await audit(actor, "ticket_updated", id, row.title, changes);
  if (v.status === "resolved" && row.was !== "resolved") {
    await audit(actor, "ticket_resolved", id, row.title, { note: v.resolutionNote });
    await writeInventoryAudit(actor, "ticket_resolved", { targetType: "ticket", targetId: id, targetLabel: row.title, details: { title: row.title, resolvedBy: actor.name, note: v.resolutionNote } });
  }
}

/** One photo of a ticket, with who raised it (to decide who may see it). Null when there is no such ticket or photo. */
export async function getTicketPhoto(id: string, which: "report" | "resolution") {
  const [row] = await db.select({ photo: which === "report" ? t.photoUrl : t.resolutionPhotoUrl, raisedByUserId: t.raisedByUserId }).from(t).where(eq(t.id, id));
  return row?.photo ? { dataUrl: row.photo, raisedByUserId: row.raisedByUserId } : null;
}
