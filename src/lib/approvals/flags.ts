import { sql } from "drizzle-orm";
import { apps } from "@/db/schema";
import { APPROVALS_URL_PATTERN } from "./approvals.manifest";

/** APPROVALS_ENABLED=true turns the module on. Unset or anything else means off: every route returns 404 and the hub hides the card. */
export const approvalsEnabled = () => ["true", "1"].includes((process.env.APPROVALS_ENABLED ?? "").trim().toLowerCase());

/**
 * Approvals is built into the hub's sidebar, not an application in a department, so a card pointing at /approvals (left over from when
 * it was one) is never listed or launched. This is the condition that keeps such a card out of the hub's app lists.
 */
export const hideApprovalsCard = () => sql`${apps.url} !~ ${APPROVALS_URL_PATTERN}`;
