import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { InventoryError } from "./errors";
import type { InventoryUser } from "./host-adapter";

/**
 * The branch a stock change happens at: the one chosen on the form, or else the person's own. It must be an active branch of the hub.
 * Nothing chosen and no branch of their own: they are asked to choose. (Saving an item a branch already keeps may name an inactive branch.)
 */
export async function branchFor(user: Pick<InventoryUser, "branchId">, chosen: string | null | undefined, opts: { allowInactive?: boolean } = {}): Promise<{ id: string; name: string }> {
  const id = chosen || user.branchId;
  if (!id) throw new InventoryError("Choose a branch.", 400);
  const [b] = await db.select({ id: branches.id, name: branches.name, active: branches.isActive }).from(branches).where(eq(branches.id, id));
  if (!b || (!b.active && !opts.allowInactive)) throw new InventoryError("That branch is not available. Reload and try again.", 404);
  return { id: b.id, name: b.name };
}

/** A person with no branch set in the hub cannot request: what they are told, on the page and by the server. */
export const NO_BRANCH_MESSAGE = "Your account is not assigned to a branch. Please contact your administrator.";
