/**
 * Maintenance photos are kept in the database as data URLs ("data:image/jpeg;base64,…"). One photo per ticket and one for its
 * resolution: a JPEG or PNG of at most 2 MB. The type is decided by the file's own first bytes, not by what the browser claimed, so
 * nothing else can be stored as an "image". No server-only imports, so the rules are unit-tested directly.
 */

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/** What the bytes really are: JPEG starts FF D8 FF, PNG starts 89 50 4E 47 0D 0A 1A 0A. Anything else: null. */
export function sniffPhoto(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";
  return null;
}

/**
 * Checks a photo sent as a data URL. Returns the data URL to store (re-labelled with the type its bytes really have) and its bytes, or
 * the reason it is refused, in words a person can act on.
 */
export function checkPhoto(dataUrl: string): { ok: true; dataUrl: string; bytes: Buffer; type: PhotoType } | { ok: false; error: string } {
  const m = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl.trim());
  if (!m) return { ok: false, error: "The photo could not be read. Choose a JPEG or PNG image." };
  if (!(PHOTO_TYPES as readonly string[]).includes(m[1])) return { ok: false, error: "Only JPEG or PNG photos can be attached." };
  // base64 is 4 characters for every 3 bytes: refuse an oversized photo before decoding it.
  if (Math.floor((m[2].length * 3) / 4) - (m[2].endsWith("==") ? 2 : m[2].endsWith("=") ? 1 : 0) > MAX_PHOTO_BYTES) {
    return { ok: false, error: "The photo is larger than 2 MB. Choose a smaller one." };
  }
  const bytes = Buffer.from(m[2], "base64");
  const type = sniffPhoto(bytes);
  if (!type) return { ok: false, error: "That file is not really a JPEG or PNG image." };
  return { ok: true, dataUrl: `data:${type};base64,${m[2]}`, bytes, type };
}
