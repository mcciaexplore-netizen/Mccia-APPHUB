const fmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: true,
});
export const formatIST = (d: Date | string | null | undefined) => (d ? fmt.format(new Date(d)) : "Never");

export const roleLabel = { head_admin: "Support admin", super_admin: "Super admin", expense_admin: "Expense admin", hr_admin: "HR admin", admin: "Admin", dept_lead: "Team manager", member: "User" } as const;
export const roleBadge = { head_admin: "badge", super_admin: "badge", expense_admin: "badge badge-green", hr_admin: "badge badge-green", admin: "badge badge-amber", dept_lead: "badge badge-purple", member: "badge badge-neutral" } as const;
