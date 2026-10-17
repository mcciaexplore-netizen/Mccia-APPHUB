import { z } from "zod";

/** Names are trimmed and inner whitespace collapsed, so "Admin  Expenses " and "Admin Expenses" are the same. */
const nameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1, "Name is required").max(120, "Keep the name under 120 characters"));

export const idSchema = z.string().uuid("Invalid id");
const sortSchema = z.number().int().min(0).max(100000);

const masterKinds = ["categories", "hr-categories", "branches", "publication-types", "publications"] as const;
export type MasterKind = (typeof masterKinds)[number];
export const kindSchema = z.enum(masterKinds);

export const masterCreate = z.object({
  name: nameSchema,
  sort: sortSchema.optional(),
  aliases: z.array(nameSchema).max(20).optional(), // categories only
  duplicateGroup: z.string().trim().max(60).nullish(), // categories only
  publicationTypeId: idSchema.optional(), // publications only
});

export const masterPatch = z
  .object({
    name: nameSchema,
    active: z.boolean(),
    sort: sortSchema,
    aliases: z.array(nameSchema).max(20),
    duplicateGroup: z.string().trim().max(60).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const categoryMerge = z.object({ sourceId: idSchema, targetId: idSchema });

export const roleGrant = z.object({
  userId: idSchema,
  role: z.enum(["viewer", "approvals_admin"]),
  granted: z.boolean(),
});

export const ruleUpdate = z
  .object({ approverUserId: idSchema.nullable(), active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");
