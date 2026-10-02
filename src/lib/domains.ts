/** Who may sign up or be added: ALLOWED_EMAIL_DOMAIN is a comma-separated list. Defaults to the two the hub is meant for. */
const DEFAULT_DOMAINS = "mcciapune.com,gmail.com";

function allowedDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAIN?.trim() || DEFAULT_DOMAINS;
  return raw.split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

/** Zoho accounts belong to the organisation, so Zoho sign-in is limited to ZOHO_ALLOWED_EMAIL_DOMAIN (default mcciapune.com). */
const DEFAULT_ZOHO_DOMAINS = "mcciapune.com";

function zohoDomains(): string[] {
  const raw = process.env.ZOHO_ALLOWED_EMAIL_DOMAIN?.trim() || DEFAULT_ZOHO_DOMAINS;
  return raw.split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

export function isEmailAllowed(email: string, provider?: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = e.slice(at + 1);
  if (provider === "zoho") return zohoDomains().includes(domain) && allowedDomains().includes(domain);
  return allowedDomains().includes(domain);
}

export const domainsLabel = () => allowedDomains().map((d) => `@${d}`).join(" or ");

/** Zoho can return "undefined undefined" when a profile has no name; fall back to the email's local part. */
export function displayName(name: string | null | undefined, email: string): string {
  const n = (name ?? "").replace(/\bundefined\b|\bnull\b/gi, "").replace(/\s+/g, " ").trim();
  return (n || email.split("@")[0]).slice(0, 120);
}
