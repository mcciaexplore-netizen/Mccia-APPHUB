/** Joins class names, skipping empty ones (what the module used clsx for). */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
