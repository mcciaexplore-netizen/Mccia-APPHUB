/**
 * Profile photos, the rules the screen and the server share (no server-only imports, so the unit tests and the browser can use them too):
 * what may be uploaded, how the type is told, and the initials shown when a person has no photo.
 */

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAX_AVATAR_MB = 2;
/** What the file picker offers. */
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

export type AvatarKind = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

/**
 * What a picture really is, from its first bytes (JPEG, PNG or WebP), not from its name or the type the browser claims: someone could
 * rename any file to photo.jpg. Anything else (an SVG, which can carry script, a PDF, a GIF) is null.
 */
export function sniffAvatar(b: Uint8Array): AvatarKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return { mime: "image/png", ext: "png" };
  // WebP: "RIFF", four size bytes, then "WEBP".
  if (b.length >= 12 && [0x52, 0x49, 0x46, 0x46].every((v, i) => b[i] === v) && [0x57, 0x45, 0x42, 0x50].every((v, i) => b[8 + i] === v)) return { mime: "image/webp", ext: "webp" };
  return null;
}

/** The refusal for a file's size, before any of it is read: the person's own message, or null when the size is fine. */
export function avatarSizeProblem(size: number): string | null {
  if (!(size > 0)) return "That file is empty.";
  if (size > MAX_AVATAR_BYTES) return `That picture is larger than ${MAX_AVATAR_MB} MB. Choose a smaller one.`;
  return null;
}

export const AVATAR_TYPE_MESSAGE = "Choose a JPG, PNG or WebP picture.";

/**
 * The letters shown instead of a photo: the first letter of the first two words, in capitals ("AI Studio" → "AS", "Vedshri Dikkar" →
 * "VD"); one word gives its first two letters ("Admin" → "AD"); nothing usable gives "?".
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).map((w) => Array.from(w.replace(/[^\p{L}\p{N}]/gu, ""))).filter((w) => w.length > 0);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : [words[0][0], words[1][0]];
  return letters.join("").toLocaleUpperCase();
}
