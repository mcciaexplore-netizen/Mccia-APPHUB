import { z } from "zod";

/**
 * What the Inventory forms may send. No server-only imports, so the client forms use the same rules. Money arrives as rupees typed by a
 * person ("1,250.50") and is stored as integer paise; quantities are whole units.
 */

export const idSchema = z.string().uuid();

/** "1,250.50" or "₹ 1250" → 125050 paise. Empty → null. More than two decimals, negatives and words are refused. */
export function rupeesToPaise(input: string): number | null | "invalid" {
  const t = input.replace(/[₹,\s]/g, "");
  if (t === "") return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return "invalid";
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

const name = (what: string) => z.string().trim().min(1, `${what} is required`).max(120, `${what} is too long (at most 120 characters)`);
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const wholeNumber = (what: string) =>
  z.coerce.number({ error: `${what} must be a number` }).int(`${what} must be a whole number`).min(0, `${what} cannot be negative`).max(10_000_000, `${what} is too large`);

export const categoryInput = z.object({ name: name("Name") });

export const itemInput = z.object({
  name: name("Name"),
  categoryId: z.union([idSchema, z.literal("")]).optional().transform((v) => (v ? v : null)),
  unit: z.string().trim().min(1, "Unit is required").max(20, "Unit is too long (at most 20 characters)"),
  quantity: wholeNumber("Quantity"),
  minQuantity: wholeNumber("Minimum stock"),
  rate: z.string().max(20).optional().default("").transform((v, ctx) => {
    const p = rupeesToPaise(v);
    if (p === "invalid") {
      ctx.addIssue({ code: "custom", message: "Rate must be an amount in rupees, such as 1250 or 1,250.50" });
      return z.NEVER;
    }
    return p;
  }),
  location: optionalText(120),
  notes: optionalText(500),
  active: z.boolean().optional().default(true),
});
export type ItemInput = z.output<typeof itemInput>;
