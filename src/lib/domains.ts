/** Email domains users may have: ALLOWED_EMAIL_DOMAIN is a comma-separated list. Empty or unset means any domain. */
function allowedDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAIN ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

export function isEmailAllowed(email: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return false;
  const list = allowedDomains();
  return list.length === 0 || list.includes(e.slice(at + 1));
}

export const domainsLabel = () => allowedDomains().map((d) => `@${d}`).join(" or ");
