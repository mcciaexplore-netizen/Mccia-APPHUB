import { z } from "zod";
import { ICONS } from "@/lib/icons";

const icon = z.string().refine((v) => v in ICONS, "Pick an icon from the list");
/** A full https:// address, or a path on this same site (a built-in app such as /approvals). */
const httpsUrl = z
  .string()
  .trim()
  .refine((v) => v.startsWith("https://") || /^\/(?!\/)[^\s\\]*$/.test(v), "URL must start with https:// (or be a path on this site, like /approvals)")
  .refine((v) => { try { new URL(v, "https://example.com"); return true; } catch { return false; } }, "Enter a valid URL");
export const uuid = z.string().uuid();
const sortOrder = z.coerce.number().int().min(0).max(100000).default(0);

export const departmentInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  icon,
  sortOrder: sortOrder.optional(),
});

export const appInput = z.object({
  departmentId: uuid,
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(140, "Keep the description to one line (140 chars)").nullish().transform((v) => v || null),
  url: httpsUrl,
  // Reserved for a future SSO handoff; only ever shown to the head admin in Administrator.
  appToken: z.string().trim().max(500).nullish().transform((v) => v || null),
  icon,
  isActive: z.boolean().optional(), // shown in the hub; omitted means unchanged (new apps start active)
  // What the administrator says it is: working, still being tested, or down. Omitted means unchanged (new apps start active).
  status: z.enum(["active", "testing", "unavailable"]).optional(),
});

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email");

export const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "department";

export const uuidList = z.array(uuid).max(5000);
