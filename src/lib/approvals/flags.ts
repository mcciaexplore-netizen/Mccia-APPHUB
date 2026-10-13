import { sql } from "drizzle-orm";
import { apps } from "@/db/schema";
import { APPROVALS_URL_PATTERN } from "./approvals.manifest";

/** APPROVALS_ENABLED=true turns the module on. Unset or anything else means off: every route returns 404 and the hub hides the card. */
export const approvalsEnabled = () => ["true", "1"].includes((process.env.APPROVALS_ENABLED ?? "").trim().toLowerCase());

/** For the hub's app list: with the module off, the Approvals card is left out so it disappears from the hub. Undefined when on. */
export const hideApprovalsCardWhenOff = () => (approvalsEnabled() ? undefined : sql`${apps.url} !~ ${APPROVALS_URL_PATTERN}`);
