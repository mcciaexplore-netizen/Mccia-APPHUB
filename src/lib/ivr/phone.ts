import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/** Normalise any Indian-style phone input to E.164 (+91XXXXXXXXXX). Returns null when it is not a usable number. */
export function normalizePhone(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  // Excel often stores numbers as 9.8765E+11 or with a trailing .0
  if (/^\d+(\.0+)?$/.test(s)) s = s.replace(/\.0+$/, "");
  s = s.replace(/[^\d+]/g, "");
  if (!s) return null;
  const parsed = parsePhoneNumberFromString(s, "IN") ?? parsePhoneNumberFromString(`+${s}`, "IN");
  if (parsed?.isValid()) return parsed.number;
  // 10-digit national number that libphonenumber rejects (e.g. test ranges)
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return null;
}

/** Mask the middle digits for list views. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.length < 8) return e164;
  return `+${d.slice(0, 2)} ${d.slice(2, 4)}•••• ${d.slice(-4)}`;
}

export function formatPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return e164;
}
