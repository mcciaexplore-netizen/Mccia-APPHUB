/** Who may sign up or be added: ALLOWED_EMAIL_DOMAIN is a comma-separated list. Defaults to the two the hub is meant for. */
const DEFAULT_DOMAINS = "mcciapune.com,gmail.com";

function allowedDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAIN?.trim() || DEFAULT_DOMAINS;
  return raw.split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

export function isEmailAllowed(email: string): boolean {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  return at > 0 && allowedDomains().includes(email.trim().toLowerCase().slice(at + 1));
}

export const domainsLabel = () => allowedDomains().map((d) => `@${d}`).join(" or ");

/** Zoho can return "undefined undefined" when a profile has no name; fall back to the email's local part. */
export function displayName(name: string | null | undefined, email: string): string {
  const n = (name ?? "").replace(/\bundefined\b|\bnull\b/gi, "").replace(/\s+/g, " ").trim();
  return (n || email.split("@")[0]).slice(0, 120);
}
