import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aprDepartments } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import { ApprovalsError } from "./errors";
import { departmentById, listDepartments, type ApprovalsUser } from "./host-adapter";

/**
 * The Budget form's Department list: the Approval System's own departments (apr_departments: seeded, and grown by anyone who types a new one)
 * together with the hub's departments (its organisation units, read through the host adapter and never changed from here). A name in both
 * shows once. A choice is the id of an Approval System department, or "hub:<id>" for one of the hub's.
 */
export type DepartmentOption = { value: string; label: string };

const HUB = "hub:";
/** The table is missing: migration 0041 (scripts/apply-0041-approvals-departments.sql) has not been run on this database. */
const tableMissing = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "42P01" || x?.cause?.code === "42P01";
};
const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
export const DEPARTMENT_VALUE = /^(hub:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function departmentOptions(): Promise<DepartmentOption[]> {
  const [own, hub] = await Promise.all([
    // Until migration 0041 has been run on a database (apr_departments missing), the form still works with the hub's departments alone.
    db.select({ id: aprDepartments.id, name: aprDepartments.name }).from(aprDepartments).where(eq(aprDepartments.active, true))
      .catch((e) => { if (tableMissing(e)) return []; throw e; }),
    listDepartments(),
  ]);
  const seen = new Set(own.map((d) => key(d.name)));
  return [
    ...own.map((d) => ({ value: d.id, label: d.name })),
    ...hub.filter((d) => !seen.has(key(d.name))).map((d) => ({ value: `${HUB}${d.id}`, label: d.name })),
  ].sort((a, b) => a.label.localeCompare(b.label));
}

/** The department a budget names, checked to be on the list now: its id (as chosen) and its name, kept with the request. */
export async function resolveDepartment(value: string): Promise<{ id: string; name: string }> {
  if (value.startsWith(HUB)) {
    const d = await departmentById(value.slice(HUB.length));
    if (d?.active) return { id: value.slice(HUB.length), name: d.name };
  } else {
    const [d] = await db.select().from(aprDepartments).where(eq(aprDepartments.id, value));
    if (d?.active) return { id: d.id, name: d.name };
  }
  throw new ApprovalsError("Pick a department from the list.");
}

/**
 * A department typed into the form, added for everyone: the same name (any capitals, any spacing) is never added twice; if it is already on
 * the list, that one is returned (a retired one of the Approval System's own comes back). Every addition is in the admin audit.
 */
export async function addDepartment(rawName: string, actor: ApprovalsUser): Promise<DepartmentOption> {
  try {
    return await addDepartmentNow(rawName, actor);
  } catch (e) {
    if (tableMissing(e)) {
      throw new ApprovalsError("New departments cannot be added yet: the database update for departments (apply-0041) has not been run. Pick one from the list, or ask the Support Admin.", 503);
    }
    throw e;
  }
}

async function addDepartmentNow(rawName: string, actor: ApprovalsUser): Promise<DepartmentOption> {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) throw new ApprovalsError("Type the department's name.");
  if (name.length > 120) throw new ApprovalsError("Keep the department's name under 120 characters.");
  const findOwn = async () => (await db.select().from(aprDepartments).where(sql`lower(${aprDepartments.name}) = ${key(name)}`))[0];

  const own = await findOwn();
  if (own) {
    if (!own.active) {
      await db.update(aprDepartments).set({ active: true }).where(eq(aprDepartments.id, own.id));
      await recordAudit(actor, "department", own.id, "update", `Brought back department "${own.name}" (typed on the Budget form)`, { active: false }, { active: true });
    }
    return { value: own.id, label: own.name };
  }
  const hub = (await listDepartments()).find((d) => key(d.name) === key(name));
  if (hub) return { value: `${HUB}${hub.id}`, label: hub.name };

  try {
    const [row] = await db.insert(aprDepartments).values({ name }).returning();
    await recordAudit(actor, "department", row.id, "create", `Added department "${row.name}" (typed on the Budget form)`, null, { id: row.id, name: row.name });
    return { value: row.id, label: row.name };
  } catch (e) {
    // Someone added the same name at the same moment: use theirs.
    const again = await findOwn();
    if (again) return { value: again.id, label: again.name };
    throw e;
  }
}
