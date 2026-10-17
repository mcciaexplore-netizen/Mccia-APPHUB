import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  aprBranches, aprCategories, aprExpenditureDetails, aprHrCategories, aprPublicationTypes, aprPublications,
} from "@/db/approvals-schema";
import { recordAudit, type AuditEntity } from "./audit";
import { ApprovalsError } from "./errors";
import type { ApprovalsUser } from "./host-adapter";
import type { MasterKind } from "./validation";

/**
 * The admin-managed lists behind the form dropdowns. Nothing is ever deleted (requests point at these rows): an item is made inactive
 * instead, which removes it from the dropdowns and keeps old requests readable. Every change is written to the admin audit.
 */

export type MasterRow = {
  id: string;
  name: string;
  active: boolean;
  sort: number;
  aliases?: string[];
  duplicateGroup?: string | null;
  mergedIntoId?: string | null;
  publicationTypeId?: string;
};

export type MasterInput = { name: string; sort?: number; aliases?: string[]; duplicateGroup?: string | null; publicationTypeId?: string };
export type MasterPatch = Partial<{ name: string; active: boolean; sort: number; aliases: string[]; duplicateGroup: string | null }>;

const META: Record<MasterKind, { entity: AuditEntity; label: string }> = {
  categories: { entity: "category", label: "category" },
  "hr-categories": { entity: "hr_category", label: "HR category" },
  branches: { entity: "branch", label: "branch" },
  "publication-types": { entity: "publication_type", label: "publication type" },
  publications: { entity: "publication", label: "publication" },
};

/** These three tables share one column shape (id, name, active, sort), so one set of queries serves them all. */
type Simple = typeof aprHrCategories;
const SIMPLE: Record<"hr-categories" | "branches" | "publication-types", Simple> = {
  "hr-categories": aprHrCategories,
  branches: aprBranches as unknown as Simple,
  "publication-types": aprPublicationTypes as unknown as Simple,
};

const simpleRow = (r: Simple["$inferSelect"]): MasterRow => ({ id: r.id, name: r.name, active: r.active, sort: r.sort });
const categoryRow = (r: typeof aprCategories.$inferSelect): MasterRow => ({
  id: r.id, name: r.name, active: r.active, sort: r.sort, aliases: r.aliases, duplicateGroup: r.duplicateGroup, mergedIntoId: r.mergedIntoId,
});
const publicationRow = (r: typeof aprPublications.$inferSelect): MasterRow => ({
  id: r.id, name: r.name, active: r.active, sort: 0, publicationTypeId: r.publicationTypeId,
});

export async function listMaster(kind: MasterKind, includeInactive: boolean): Promise<MasterRow[]> {
  if (kind === "categories") {
    const rows = await db.select().from(aprCategories).where(includeInactive ? undefined : eq(aprCategories.active, true)).orderBy(asc(aprCategories.sort), asc(aprCategories.name));
    return rows.map(categoryRow);
  }
  if (kind === "publications") {
    const rows = await db.select().from(aprPublications).where(includeInactive ? undefined : eq(aprPublications.active, true)).orderBy(asc(aprPublications.name));
    return rows.map(publicationRow);
  }
  const t = SIMPLE[kind];
  const rows = await db.select().from(t).where(includeInactive ? undefined : eq(t.active, true)).orderBy(asc(t.sort), asc(t.name));
  return rows.map(simpleRow);
}

async function getOne(kind: MasterKind, id: string): Promise<MasterRow> {
  const row = (await listMaster(kind, true)).find((r) => r.id === id);
  if (!row) throw new ApprovalsError(`That ${META[kind].label} no longer exists.`, 404);
  return row;
}

export async function createMaster(kind: MasterKind, input: MasterInput, actor: ApprovalsUser): Promise<MasterRow> {
  let row: MasterRow;
  if (kind === "categories") {
    const [r] = await db
      .insert(aprCategories)
      .values({ name: input.name, sort: input.sort ?? 0, aliases: input.aliases ?? [], duplicateGroup: input.duplicateGroup || null })
      .returning();
    row = categoryRow(r);
  } else if (kind === "publications") {
    if (!input.publicationTypeId) throw new ApprovalsError("Pick a publication type first.");
    const [type] = await db.select({ id: aprPublicationTypes.id }).from(aprPublicationTypes).where(eq(aprPublicationTypes.id, input.publicationTypeId));
    if (!type) throw new ApprovalsError("That publication type no longer exists.", 404);
    const [r] = await db.insert(aprPublications).values({ name: input.name, publicationTypeId: input.publicationTypeId }).returning();
    row = publicationRow(r);
  } else {
    const [r] = await db.insert(SIMPLE[kind]).values({ name: input.name, sort: input.sort ?? 0 }).returning();
    row = simpleRow(r);
  }
  await recordAudit(actor, META[kind].entity, row.id, "create", `Added ${META[kind].label} "${row.name}"`, null, row);
  return row;
}

export async function updateMaster(kind: MasterKind, id: string, patch: MasterPatch, actor: ApprovalsUser): Promise<MasterRow> {
  const before = await getOne(kind, id);
  // Aliases and duplicate flags only exist on categories, and order not on publications: a patch with nothing this list can use is a mistake.
  const usable = kind === "categories" ? ["name", "active", "sort", "aliases", "duplicateGroup"] : kind === "publications" ? ["name", "active"] : ["name", "active", "sort"];
  if (!Object.keys(patch).some((k) => usable.includes(k))) throw new ApprovalsError("Nothing to change.");
  let after: MasterRow;
  if (kind === "categories") {
    const [r] = await db
      .update(aprCategories)
      .set({ name: patch.name, active: patch.active, sort: patch.sort, aliases: patch.aliases, duplicateGroup: patch.duplicateGroup })
      .where(eq(aprCategories.id, id))
      .returning();
    after = categoryRow(r);
  } else if (kind === "publications") {
    const [r] = await db.update(aprPublications).set({ name: patch.name, active: patch.active }).where(eq(aprPublications.id, id)).returning();
    after = publicationRow(r);
  } else {
    const t = SIMPLE[kind];
    const [r] = await db.update(t).set({ name: patch.name, active: patch.active, sort: patch.sort }).where(eq(t.id, id)).returning();
    after = simpleRow(r);
  }
  const changed = (Object.keys(patch) as (keyof MasterPatch)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.length) {
    await recordAudit(actor, META[kind].entity, id, "update", `Updated ${META[kind].label} "${before.name}": ${changed.join(", ")}`, before, after);
  }
  return after;
}

/** Case-insensitive union, keeping the first spelling of each. */
const union = (...lists: string[][]) => {
  const seen = new Set<string>();
  return lists.flat().filter((n) => !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()));
};

/**
 * Folds one category into another: requests move to the target, the source's name and aliases become aliases of the target, and the
 * source is deactivated. The statements run in an order that is safe to repeat, so a merge that stopped half way can simply be run again.
 */
export async function mergeCategories(sourceId: string, targetId: string, actor: ApprovalsUser): Promise<MasterRow> {
  if (sourceId === targetId) throw new ApprovalsError("Pick two different categories.");
  const [source] = await db.select().from(aprCategories).where(eq(aprCategories.id, sourceId));
  const [target] = await db.select().from(aprCategories).where(eq(aprCategories.id, targetId));
  if (!source || !target) throw new ApprovalsError("That category no longer exists.", 404);
  if (source.mergedIntoId) throw new ApprovalsError(`"${source.name}" has already been merged.`, 409);
  if (target.mergedIntoId || !target.active) throw new ApprovalsError(`"${target.name}" is inactive, so nothing can be merged into it.`, 409);

  await db.update(aprExpenditureDetails).set({ categoryId: targetId }).where(eq(aprExpenditureDetails.categoryId, sourceId));

  const aliases = union(target.aliases, [source.name], source.aliases).filter((a) => a.toLowerCase() !== target.name.toLowerCase());
  await db.update(aprCategories).set({ aliases }).where(eq(aprCategories.id, targetId));
  await db.update(aprCategories).set({ active: false, mergedIntoId: targetId, duplicateGroup: null }).where(eq(aprCategories.id, sourceId));

  // A group with a single member left is no longer a duplicate.
  if (source.duplicateGroup) {
    const left = await db.select({ id: aprCategories.id }).from(aprCategories).where(and(eq(aprCategories.duplicateGroup, source.duplicateGroup), eq(aprCategories.active, true)));
    if (left.length <= 1) await db.update(aprCategories).set({ duplicateGroup: null }).where(eq(aprCategories.duplicateGroup, source.duplicateGroup));
  }

  const [after] = await db.select().from(aprCategories).where(eq(aprCategories.id, targetId));
  await recordAudit(actor, "category", targetId, "merge", `Merged category "${source.name}" into "${target.name}"`, categoryRow(source), categoryRow(after));
  return categoryRow(after);
}
