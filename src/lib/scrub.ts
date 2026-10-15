// Defence in depth for the audit log: whatever a caller passes, nothing that looks like a secret is ever stored.
const SECRET_KEY = /pass(word)?|token|secret|hash|link|cookie|authorization/i;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => scrub(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !SECRET_KEY.test(k)).map(([k, v]) => [k, scrub(v, depth + 1)]));
  }
  return typeof value === "string" ? value.slice(0, 500) : value;
}
