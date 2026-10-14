import { sql } from "drizzle-orm";
import { apps } from "@/db/schema";
import { APPROVALS_URL_PATTERN, isModuleEnabled } from "./approvals.manifest";

/**
 * Approvals is on by default. APPROVALS_ENABLED=false switches it off: every /approvals page and /api/approvals route returns 404 and the
 * hub hides the Approval System item.
 */
export const approvalsEnabled = () => isModuleEnabled(process.env.APPROVALS_ENABLED);

/**
 * Approvals is built into the hub's sidebar, not an application in a department, so a card pointing at /approvals (left over from when
 * it was one) is never listed or launched. This is the condition that keeps such a card out of the hub's app lists.
 */
export const hideApprovalsCard = () => sql`${apps.url} !~ ${APPROVALS_URL_PATTERN}`;
