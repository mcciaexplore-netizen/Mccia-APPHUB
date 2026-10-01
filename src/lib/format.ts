const fmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: true,
});
export const formatIST = (d: Date | string | null | undefined) => (d ? fmt.format(new Date(d)) : "Never");

export const roleLabel = { head_admin: "Head admin", dept_lead: "Department admin", member: "User" } as const;
export const roleBadge = { head_admin: "badge", dept_lead: "badge badge-purple", member: "badge badge-neutral" } as const;
