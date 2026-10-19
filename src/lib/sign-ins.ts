import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lt, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";

/** Sign-in attempts, successful and failed, for the Sign-ins tab of the Activity Log. Passwords are never recorded. */
export type SignInFilters = { q?: string; outcome?: "ok" | "failed"; from?: string; to?: string; dir: "asc" | "desc"; page: number };
const PAGE = 50;
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);

export async function listSignIns(f: SignInFilters) {
  const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const where = and(
    f.q ? ilike(loginAttempts.email, like(f.q)) : undefined,
    f.outcome ? eq(loginAttempts.success, f.outcome === "ok") : undefined,
    f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? gte(loginAttempts.createdAt, dayStart(f.from)) : undefined,
    f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? lt(loginAttempts.createdAt, new Date(dayStart(f.to).getTime() + 86_400_000)) : undefined,
  ) as SQL | undefined;
  const [rows, [{ n }]] = await Promise.all([
    db.select({ id: loginAttempts.id, at: loginAttempts.createdAt, email: loginAttempts.email, ip: loginAttempts.ipAddress, success: loginAttempts.success })
      .from(loginAttempts).where(where)
      .orderBy(f.dir === "asc" ? asc(loginAttempts.createdAt) : desc(loginAttempts.createdAt), desc(loginAttempts.id)).limit(PAGE).offset((f.page - 1) * PAGE),
    db.select({ n: count() }).from(loginAttempts).where(where),
  ]);
  return { rows, total: n, pages: Math.max(1, Math.ceil(n / PAGE)) };
}
