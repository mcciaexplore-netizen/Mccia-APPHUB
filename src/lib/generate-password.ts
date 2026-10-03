// Browser-safe (Web Crypto) so the admin screens can suggest passwords.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePassword(length = 14) {
  const bytes = new Uint32Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  // Guarantee the letter + number rule.
  if (!/\d/.test(out)) out = out.slice(0, -1) + String(2 + (bytes[0] % 8));
  return out;
}
