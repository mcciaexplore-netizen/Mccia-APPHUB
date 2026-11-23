import "server-only";
import { approverIdFor } from "./leave";
import { listMembers, peopleByIds } from "./host-adapter";
import { NO_MANAGER_NOTE } from "./att.manifest";

/** Who a person's requests go to, in words, for the forms. */
export async function approverName(userId: string): Promise<string> {
  const id = await approverIdFor(userId);
  if (!id) return `HR (${NO_MANAGER_NOTE})`;
  return `${(await peopleByIds([id])).get(id)?.name ?? "your manager"} (your manager)`;
}

export type OrgNode = { id: string; name: string; designation: string | null; managerId: string | null };

/**
 * The org chart: everyone Attendance covers, each under their reporting manager. Anyone with no manager (or a manager outside Attendance)
 * sits under "HR", the chart's root (managerId null).
 */
export async function orgNodes(): Promise<OrgNode[]> {
  const members = await listMembers();
  const ids = new Set(members.map((m) => m.id));
  return members.map((m) => ({ id: m.id, name: m.name, designation: m.designation, managerId: m.managerId && ids.has(m.managerId) && m.managerId !== m.id ? m.managerId : null }));
}
