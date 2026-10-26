/** Someone who holds one of the roles only one person may have (Super Admin, Expense Admin, HR Admin). */
export type RoleHolder = { id: string; name: string; role: string };

const CHOICES: [value: string, label: string, single: boolean][] = [
  ["super_admin", "Super Admin", true],
  ["expense_admin", "Expense Admin", true],
  ["hr_admin", "HR Admin", true],
  ["admin", "Admin", false],
  ["member", "User", false],
];

/**
 * The choices of the Role dropdown. A role only one person may hold, and someone else already holds, is shown as taken and cannot be picked
 * (the server refuses it too). Without `canPromote` only User is offered. A Team manager keeps that choice while they still have it.
 */
export function RoleOptions({ holders, personId, canPromote, current }: { holders: RoleHolder[]; personId: string | null; canPromote: boolean; current: string }) {
  return (
    <>
      {CHOICES.filter(([v]) => canPromote || v === "member" || v === current).map(([v, label, single]) => {
        const taken = single ? holders.find((h) => h.role === v && h.id !== personId) : undefined;
        return <option key={v} value={v} disabled={!!taken}>{taken ? `${label} (taken by ${taken.name})` : label}</option>;
      })}
      {current === "dept_lead" && <option value="dept_lead">Team manager</option>}
    </>
  );
}
