import "server-only";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { inventoryAmc as a, inventoryCategories, inventoryVendors } from "@/db/inventory-schema";
import { writeInventoryAudit } from "./audit";
import { fyLabel, type AmcType } from "./amc-shared";
import { branchFor } from "./branches";
import { InventoryError } from "./errors";
import type { InventoryUser } from "./host-adapter";
import type { AmcInput } from "./validation";

/**
 * Annual Maintenance Contracts (Inventory > Maintenance > AMC). Inventory admins only: they add, edit and delete the contracts of every
 * branch, filter them by branch, category, financial year and vendor, and export what the filters show. Each change is written to the
 * Inventory audit log (AMC added, edited, deleted). Amounts are paise (see src/db/inventory-schema.ts).
 */

type Actor = Pick<InventoryUser, "id" | "name">;

export type AmcRow = {
  id: string;
  branchId: string;
  branchName: string;
  categoryId: string | null;
  categoryName: string | null;
  equipmentService: string;
  vendorName: string;
  vendorId: string | null;
  amcType: AmcType;
  /** The first of the two financial years the amounts are for (2025 = FY 2025-26 and 2026-27). */
  fyStartYear: number;
  startDate: string | null;
  endDate: string | null;
  amountCurrentFy: number | null;
  amountNextFy: number | null;
  notes: string | null;
};

export type AmcFilters = { branchId?: string; categoryId?: string; fy?: number; vendor?: string };

const isId = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);

const columns = {
  id: a.id, branchId: a.branchId, branchName: branches.name, categoryId: a.categoryId, categoryName: inventoryCategories.name,
  equipmentService: a.equipmentService, vendorName: a.vendorName, vendorId: a.vendorId, amcType: a.amcType, fyStartYear: a.fyStartYear,
  startDate: a.startDate, endDate: a.endDate, amountCurrentFy: a.amountCurrentFy, amountNextFy: a.amountNextFy, notes: a.notes,
};

/** The contracts the filters match: by branch, then in the order they were added. */
export async function listAmc(f: AmcFilters): Promise<AmcRow[]> {
  const where: SQL[] = [];
  if (isId(f.branchId)) where.push(eq(a.branchId, f.branchId));
  if (isId(f.categoryId)) where.push(eq(a.categoryId, f.categoryId));
  if (f.fy != null && Number.isInteger(f.fy)) where.push(eq(a.fyStartYear, f.fy));
  const vendor = f.vendor?.trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`);
  if (vendor) where.push(ilike(a.vendorName, `%${vendor}%`));
  return db
    .select(columns)
    .from(a)
    .innerJoin(branches, eq(branches.id, a.branchId))
    .leftJoin(inventoryCategories, eq(inventoryCategories.id, a.categoryId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(sql`lower(${branches.name})`), asc(a.createdAt), asc(a.id))
    .limit(5000);
}

/** The financial years contracts are kept for (a branch's only, when one is given), newest first. */
export async function amcYearsInUse(branchId?: string): Promise<number[]> {
  const rows = await db.selectDistinct({ y: a.fyStartYear }).from(a).where(isId(branchId) ? eq(a.branchId, branchId) : undefined).orderBy(desc(a.fyStartYear));
  return rows.map((r) => r.y);
}

export type AmcBranchSummary = { id: string; name: string; active: boolean; count: number; amount: number };

/**
 * One line per branch for the AMC landing page: how many contracts it has (of any year) and what they cost in the financial year `fy`
 * (given as its start year; see amountInFy), in paise. Every active branch is listed, with zero when it has none; a branch that has since
 * been switched off only while it still has contracts.
 */
export async function amcBranchSummaries(fy: number): Promise<AmcBranchSummary[]> {
  const count = sql<number>`count(${a.id})`.mapWith(Number);
  const amount = sql<number>`coalesce(sum(case when ${a.fyStartYear} = ${fy} then ${a.amountCurrentFy} when ${a.fyStartYear} = ${fy - 1} then ${a.amountNextFy} end), 0)`.mapWith(Number);
  return db
    .select({ id: branches.id, name: branches.name, active: branches.isActive, count, amount })
    .from(branches)
    .leftJoin(a, eq(a.branchId, branches.id))
    .groupBy(branches.id)
    .having(or(eq(branches.isActive, true), sql`count(${a.id}) > 0`))
    .orderBy(asc(sql`lower(${branches.name})`));
}

/** The vendor chosen from the directory, or none when it is gone (the name typed is kept either way). */
async function directoryVendor(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [v] = await db.select({ id: inventoryVendors.id }).from(inventoryVendors).where(eq(inventoryVendors.id, id));
  return v?.id ?? null;
}

async function checkedCategory(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [c] = await db.select({ id: inventoryCategories.id }).from(inventoryCategories).where(eq(inventoryCategories.id, id));
  if (!c) throw new InventoryError("That category is not available. Reload and try again.", 404);
  return c.id;
}

const label = (v: AmcInput) => `${v.equipmentService} (${v.vendorName})`;
const summary = (v: AmcInput) => ({ equipment: v.equipmentService, vendor: v.vendorName, type: v.amcType, years: `${fyLabel(v.fyStartYear)} & ${fyLabel(v.fyStartYear + 1)}` });

export async function createAmc(v: AmcInput, actor: Actor): Promise<{ id: string }> {
  const branch = await branchFor({ branchId: null }, v.branchId);
  const [row] = await db
    .insert(a)
    .values({
      branchId: branch.id, categoryId: await checkedCategory(v.categoryId), equipmentService: v.equipmentService, vendorName: v.vendorName,
      vendorId: await directoryVendor(v.vendorId), amcType: v.amcType, fyStartYear: v.fyStartYear, startDate: v.startDate, endDate: v.endDate,
      amountCurrentFy: v.amountCurrentFy, amountNextFy: v.amountNextFy, notes: v.notes, createdBy: actor.id,
    })
    .returning({ id: a.id });
  await writeInventoryAudit(actor, "amc_added", { targetType: "amc", targetId: row.id, targetLabel: label(v), branchId: branch.id, details: summary(v) });
  return row;
}

const FIELDS = ["branchId", "categoryId", "equipmentService", "vendorName", "amcType", "fyStartYear", "startDate", "endDate", "amountCurrentFy", "amountNextFy", "notes"] as const;

export async function updateAmc(id: string, v: AmcInput, actor: Actor): Promise<void> {
  const [before] = await db.select().from(a).where(eq(a.id, id));
  if (!before) throw new InventoryError("That contract no longer exists. Reload and try again.", 404);
  // A branch that has been switched off since may stay on a contract that already has it.
  const branch = await branchFor({ branchId: null }, v.branchId, { allowInactive: true });
  await db
    .update(a)
    .set({
      branchId: branch.id, categoryId: await checkedCategory(v.categoryId), equipmentService: v.equipmentService, vendorName: v.vendorName,
      vendorId: await directoryVendor(v.vendorId), amcType: v.amcType, fyStartYear: v.fyStartYear, startDate: v.startDate, endDate: v.endDate,
      amountCurrentFy: v.amountCurrentFy, amountNextFy: v.amountNextFy, notes: v.notes, updatedAt: new Date(),
    })
    .where(eq(a.id, id));
  const next = { ...v, branchId: branch.id } as Record<(typeof FIELDS)[number], unknown>;
  const changed = FIELDS.filter((k) => (before[k] ?? null) !== (next[k] ?? null));
  await writeInventoryAudit(actor, "amc_edited", { targetType: "amc", targetId: id, targetLabel: label(v), branchId: branch.id, details: { ...summary(v), changed } });
}

export async function deleteAmc(id: string, actor: Actor): Promise<void> {
  const [gone] = await db.delete(a).where(eq(a.id, id)).returning({ equipment: a.equipmentService, vendor: a.vendorName, branchId: a.branchId, type: a.amcType, fy: a.fyStartYear });
  if (!gone) throw new InventoryError("That contract no longer exists. Reload and try again.", 404);
  await writeInventoryAudit(actor, "amc_deleted", {
    targetType: "amc", targetId: id, targetLabel: `${gone.equipment} (${gone.vendor})`, branchId: gone.branchId,
    details: { equipment: gone.equipment, vendor: gone.vendor, type: gone.type, years: `${fyLabel(gone.fy)} & ${fyLabel(gone.fy + 1)}` },
  });
}

/** The filters from a page's or an export's query string (anything that is not what it should be is ignored by listAmc). */
export const amcFiltersFrom = (get: (key: string) => string | null | undefined): AmcFilters => ({
  branchId: get("branch") || undefined,
  categoryId: get("category") || undefined,
  fy: get("fy") ? Number(get("fy")) : undefined,
  vendor: get("vendor") || undefined,
});
