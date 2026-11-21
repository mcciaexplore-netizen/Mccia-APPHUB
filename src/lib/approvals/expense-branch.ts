/**
 * The Branch of an expense, as plain functions (no database: the form, the server and the unit tests share them). Only an expense in the
 * category "Administrative Expenses" asks for it, and then it must be given: one of the hub's branches, the same list people's profiles use.
 * It is kept with the request's other answers (apr_requests.custom_values) as { key: "branch", label: "Branch", value: <name>, ref: <id> }:
 * the name as it was when the request was raised, and the branch's id for the Branch filter. No column of its own, so no migration.
 */

/** The expense category that asks for a branch, by name (any case or spacing). */
export const BRANCH_CATEGORY = "Administrative Expenses";
const squash = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
export const needsBranch = (categoryName: string | null | undefined): boolean => !!categoryName && squash(categoryName) === squash(BRANCH_CATEGORY);

/** The key of the answer that holds the branch. Extra fields the Support Admin adds have keys like "c_1a2b3c4d", so this one never clashes. */
export const BRANCH_KEY = "branch";
export type BranchAnswer = { key: typeof BRANCH_KEY; label: "Branch"; value: string; ref: string };
export const branchAnswer = (b: { id: string; name: string }): BranchAnswer => ({ key: BRANCH_KEY, label: "Branch", value: b.name, ref: b.id });

type Answer = { key: string; label: string; value: string; ref?: string };
/** A request's answers split into its branch (if it has one) and the answers to the extra fields. */
export function splitBranch<T extends Answer>(answers: readonly T[] | null | undefined): { branch: { id: string; name: string } | null; rest: T[] } {
  const list = answers ?? [];
  const b = list.find((a) => a.key === BRANCH_KEY);
  return { branch: b ? { id: b.ref ?? "", name: b.value } : null, rest: list.filter((a) => a.key !== BRANCH_KEY) };
}
