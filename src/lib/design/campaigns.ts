import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { campaigns, socialPosts } from "@/db/design-schema";
import { DesignError, type SessionUser } from "./dal";
import { claimFiles, deleteFiles, filesByIds } from "./files";
import { peopleByIds } from "./host-adapter";
import { PLATFORMS } from "./platforms";

/**
 * Campaigns and social posts, open to every signed-in hub user. A campaign is a named date range (design leads add and edit them); a post
 * is something posted or planned on a platform, optionally under a campaign, with an image (anyone adds them; the person who added a post,
 * or a lead, may change or delete it).
 */

export { PLATFORMS };

export type CampaignDto = { id: string; name: string; description: string | null; color: string; startDate: string; endDate: string; createdBy: string | null };
export type PostDto = {
  id: string;
  campaignId: string | null;
  platform: string;
  title: string;
  postUrl: string | null;
  postDate: string;
  status: "planned" | "posted";
  notes: string | null;
  image: { fileId: string; fileName: string } | null;
  createdBy: string | null;
  createdById: string;
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date");
export const campaignInput = z
  .object({
    name: z.string().trim().min(1, "Give the campaign a name").max(120),
    description: z.string().trim().max(1000).default(""),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour").default("#003F8A"),
    startDate: day,
    endDate: day,
  })
  .refine((v) => v.endDate >= v.startDate, { message: "The end date cannot be before the start date" });
export const postInput = z.object({
  campaignId: z.string().uuid().nullable().default(null),
  platform: z.enum(PLATFORMS),
  title: z.string().trim().min(1, "Give the post a title").max(200),
  postUrl: z.union([z.literal(""), z.string().trim().url("Paste the post's full link").max(500)]).default(""),
  postDate: day,
  status: z.enum(["planned", "posted"]),
  notes: z.string().trim().max(1000).default(""),
  imageFileId: z.string().uuid().nullable().default(null),
  removeImage: z.boolean().default(false),
});

export async function listCampaigns(): Promise<{ campaigns: CampaignDto[]; posts: PostDto[] }> {
  const [cs, ps] = await Promise.all([db.select().from(campaigns).orderBy(desc(campaigns.startDate)), db.select().from(socialPosts).orderBy(asc(socialPosts.postDate)).limit(1000)]);
  const [people, fs] = await Promise.all([peopleByIds([...cs.map((c) => c.createdBy), ...ps.map((p) => p.createdBy)]), filesByIds(ps.map((p) => p.imageFileId))]);
  return {
    campaigns: cs.map((c) => ({ id: c.id, name: c.name, description: c.description, color: c.color, startDate: c.startDate, endDate: c.endDate, createdBy: people.get(c.createdBy)?.name ?? null })),
    posts: ps.map((p) => {
      const f = p.imageFileId ? fs.get(p.imageFileId) : null;
      return {
        id: p.id,
        campaignId: p.campaignId,
        platform: p.platform,
        title: p.title,
        postUrl: p.postUrl,
        postDate: p.postDate,
        status: p.status,
        notes: p.notes,
        image: f ? { fileId: f.id, fileName: f.fileName } : null,
        createdBy: people.get(p.createdBy)?.name ?? null,
        createdById: p.createdBy,
      };
    }),
  };
}

export async function saveCampaign(u: SessionUser, id: string | null, input: z.input<typeof campaignInput>): Promise<string> {
  if (!u.lead) throw new DesignError("Only a design lead can add or change campaigns.");
  const v = campaignInput.parse(input);
  const row = { name: v.name, description: v.description || null, color: v.color, startDate: v.startDate, endDate: v.endDate };
  if (id) {
    await db.update(campaigns).set(row).where(eq(campaigns.id, id));
    return id;
  }
  const [c] = await db.insert(campaigns).values({ ...row, createdBy: u.id }).returning({ id: campaigns.id });
  return c.id;
}

/** Deletes a campaign; its posts stay, no longer in a campaign. */
export async function deleteCampaign(u: SessionUser, id: string): Promise<void> {
  if (!u.lead) throw new DesignError("Only a design lead can delete campaigns.");
  await db.update(socialPosts).set({ campaignId: null }).where(eq(socialPosts.campaignId, id));
  await db.delete(campaigns).where(eq(campaigns.id, id));
}

export async function savePost(u: SessionUser, id: string | null, input: z.input<typeof postInput>): Promise<string> {
  const v = postInput.parse(input);
  if (v.campaignId) {
    const [c] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, v.campaignId)).limit(1);
    if (!c) throw new DesignError("That campaign was not found.");
  }
  let existing: typeof socialPosts.$inferSelect | undefined;
  if (id) {
    [existing] = await db.select().from(socialPosts).where(eq(socialPosts.id, id)).limit(1);
    if (!existing) throw new DesignError("That post was not found.");
    if (existing.createdBy !== u.id && !u.lead) throw new DesignError("Only the person who added a post, or a design lead, can change it.");
  }
  let imageFileId = existing?.imageFileId ?? null;
  const oldImage = imageFileId;
  if (v.imageFileId) imageFileId = (await claimFiles(u.id, [v.imageFileId], "post_image"))[0].id;
  else if (v.removeImage) imageFileId = null;
  const row = { campaignId: v.campaignId, platform: v.platform, title: v.title, postUrl: v.postUrl || null, postDate: v.postDate, status: v.status, notes: v.notes || null, imageFileId };
  let postId = id;
  if (id) await db.update(socialPosts).set(row).where(eq(socialPosts.id, id));
  else postId = (await db.insert(socialPosts).values({ ...row, createdBy: u.id }).returning({ id: socialPosts.id }))[0].id;
  if (oldImage && oldImage !== imageFileId) await deleteFiles([oldImage]);
  return postId!;
}

export async function deletePost(u: SessionUser, id: string): Promise<void> {
  const [p] = await db.select().from(socialPosts).where(eq(socialPosts.id, id)).limit(1);
  if (!p) throw new DesignError("That post was not found.");
  if (p.createdBy !== u.id && !u.lead) throw new DesignError("Only the person who added a post, or a design lead, can delete it.");
  await db.delete(socialPosts).where(eq(socialPosts.id, id));
  if (p.imageFileId) await deleteFiles([p.imageFileId]);
}

/** Whether a stored file is a post image (so any signed-in user may see it). */
export async function isPostImage(fileId: string): Promise<boolean> {
  const [p] = await db.select({ id: socialPosts.id }).from(socialPosts).where(eq(socialPosts.imageFileId, fileId)).limit(1);
  return !!p;
}
