import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { apps, type User } from "@/db/schema";
import { getAccessibleApps } from "@/lib/access";
import { approvalsManifest, isApprovalsUrl } from "./approvals.manifest";

/** Where the hub's sidebar sends a person who clicks a department that is only the Approvals module. */
export const APPROVALS_ENTRY = approvalsManifest.basePath;

/**
 * Departments in which the only app this person can open is the Approvals card. The sidebar links those straight into the module
 * instead of to a page holding one card, so clicking "Approval System" opens the approvals themselves. A department that also holds
 * other apps still opens as a normal department page.
 */
export async function directApprovalsDepartments(user: Pick<User, "id" | "role">): Promise<Set<string>> {
  const mine = await getAccessibleApps(user);
  if (mine.length === 0) return new Set();
  const urls = await db.select({ id: apps.id, url: apps.url }).from(apps).where(inArray(apps.id, mine.map((a) => a.id)));
  const cards = new Set(urls.filter((u) => isApprovalsUrl(u.url)).map((u) => u.id));
  const count = new Map<string, { all: number; cards: number }>();
  for (const a of mine) {
    const c = count.get(a.departmentId) ?? { all: 0, cards: 0 };
    c.all++;
    if (cards.has(a.id)) c.cards++;
    count.set(a.departmentId, c);
  }
  return new Set([...count].filter(([, c]) => c.cards > 0 && c.cards === c.all).map(([id]) => id));
}
