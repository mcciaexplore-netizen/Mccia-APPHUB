import "server-only";
import { z } from "zod";
import type { ExpenditureFormProps } from "@/components/approvals/RequestForms";
import { hasRole, listUsers, type ApprovalsUser } from "./host-adapter";
import { listMaster, type MasterRow } from "./masters";
import { getSettings } from "./settings";

const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
const options = (rows: MasterRow[]) => rows.map((r) => ({ value: r.id, label: r.name })).sort(byName);

const uuid = z.string().uuid();
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const idOrEmpty = (v: string | string[] | undefined) => (uuid.safeParse(first(v)).success ? first(v) : "");

/** Everything an expenditure form needs, read once on the server so the form opens with its lists already filled. */
export async function expenditureFormProps(
  form: "large" | "small", user: ApprovalsUser, search: Record<string, string | string[] | undefined>,
): Promise<ExpenditureFormProps> {
  const [categories, branches, types, publications, people, settings] = await Promise.all([
    listMaster("categories", false), listMaster("branches", false), listMaster("publication-types", false), listMaster("publications", false), listUsers(), getSettings(),
  ]);
  const amount = first(search.amount);
  return {
    form,
    people: people.map((u) => ({ value: u.id, label: u.name, email: u.email })).sort(byName),
    meId: user.id,
    categories: options(categories),
    branches: options(branches),
    publicationTypes: options(types),
    publications: publications.filter((p) => p.publicationTypeId).map((p) => ({ value: p.id, label: p.name, typeId: p.publicationTypeId! })).sort(byName),
    thresholdPaise: settings.thresholdPaise,
    canAdd: hasRole(user, "approvals_admin"),
    now: new Date().toISOString(),
    initial: {
      employeeId: idOrEmpty(search.employee), email: first(search.email).slice(0, 200), categoryId: idOrEmpty(search.category), branchId: idOrEmpty(search.branch),
      nature: first(search.nature).slice(0, 2000), vendor: first(search.vendor).slice(0, 500), amount: /^[\d.,\s]{0,20}$/.test(amount) ? amount : "",
    },
  };
}

export const hrFormProps = async (user: ApprovalsUser) => ({
  me: { name: user.name, email: user.email },
  categories: options(await listMaster("hr-categories", false)),
  canAdd: hasRole(user, "approvals_admin"),
  now: new Date().toISOString(),
});
