import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { Role, User } from "@/db/schema";
import { INVITE_HOURS } from "@/lib/invites";

/**
 * Creates one account, with its applications and (optionally) its one-time invitation, as ONE database statement: all of it is saved
 * or none of it is, so a failure never leaves a half-made account, and a second try with the same email simply finds it already there.
 * Used by both the single "Add user" form and the bulk import, so they can never drift apart.
 */
export type NewAccount = {
  name: string; email: string; role: Exclude<Role, "head_admin">;
  branchId: string | null; teamId: string | null; managerId: string | null; designation: string | null;
  appIds: string[];
  /** A scrypt hash when the administrator chose to set the password; null when the person will choose their own. Never plaintext. */
  passwordHash: string | null;
  /** The SHA-256 hash of an invitation token to store, or null for no invitation. The token itself never reaches this file. */
  inviteTokenHash: string | null;
  source: "admin" | "import";
};

const idList = (ids: readonly string[]): SQL => sql.join(ids.map((i) => sql`${i}`), sql`, `);

/** Returns the new person's id, or null when an account with that email already exists (nothing was changed). */
export async function createAccount(actor: Pick<User, "id">, a: NewAccount): Promise<string | null> {
  const grants = a.appIds.length
    ? sql`, g as (insert into user_app_access (user_id, app_id, granted_by_id) select u.id, x.id, ${actor.id}::uuid from u cross join apps x where x.id in (${idList(a.appIds)}) on conflict (user_id, app_id) do nothing returning 1)`
    : sql``;
  const invite = a.inviteTokenHash
    ? sql`, i as (insert into user_invites (user_id, token_hash, expires_at, created_by_id, delivery) select u.id, ${a.inviteTokenHash}, now() + ${`${INVITE_HOURS} hours`}::interval, ${actor.id}::uuid, 'pending' from u returning 1)`
    : sql``;
  const res = (await db.execute(sql`
    with u as (
      insert into users (name, email, role, branch_id, team_id, reporting_manager_id, designation, password_hash, signup_source, status, reviewed_at, reviewed_by_id)
      values (${a.name}, ${a.email}, ${a.role}::role, ${a.branchId}::uuid, ${a.teamId}::uuid, ${a.managerId}::uuid, ${a.designation}, ${a.passwordHash}, ${a.source}, 'approved', now(), ${actor.id}::uuid)
      on conflict (email) do nothing returning id
    ) ${grants} ${invite}
    select id from u`)) as unknown as { rows: { id: string }[] };
  return res.rows[0]?.id ?? null;
}
