/** Who may be added as a user: ALLOWED_EMAIL_DOMAIN is a comma-separated list. Defaults to the two the hub is meant for. */
const DEFAULT_DOMAINS = "mcciapune.com,gmail.com";

function allowedDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAIN?.trim() || DEFAULT_DOMAINS;
  return raw.split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

export function isEmailAllowed(email: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at > 0 && allowedDomains().includes(e.slice(at + 1));
}

export const domainsLabel = () => allowedDomains().map((d) => `@${d}`).join(" or ");
