import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// A request that could not even reach the database (DNS or connection failure) never ran, so trying again is safe, even for a
// write. Anything that failed after the request was sent is not retried, so nothing can be applied twice.
const NEVER_SENT = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);
const codeOf = (e: unknown): string | undefined => {
  let c = e as { code?: unknown; cause?: unknown } | undefined;
  for (let i = 0; i < 5 && c; i++, c = c.cause as typeof c) if (typeof c.code === "string") return c.code;
};
neonConfig.fetchFunction = async (input: RequestInfo | URL, init?: RequestInit) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      if (attempt >= 2 || !NEVER_SENT.has(codeOf(e) ?? "")) throw e;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1) ** 2));
    }
  }
};

/**
 * The single place that knows which Postgres driver is active.
 * DB_DRIVER=neon (default) | pg. Everything else imports `db` from here.
 * Both drivers expose the same query-builder API. Note: neon-http has no
 * interactive transactions, so app code must not rely on db.transaction().
 */
/** A database on this same machine (localhost, 127.0.0.1 or ::1). */
const isLocalDatabase = (url: string) => {
  try {
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  if ((process.env.DB_DRIVER ?? "neon") === "pg") {
    const pool = new Pool({
      connectionString: url,
      // 5 by default. With many people using the site at once, raise it with DB_POOL_MAX (stay under the database's own connection limit).
      max: Math.max(1, Math.min(100, Number(process.env.DB_POOL_MAX) || 5)),
      // Always encrypted, with the server's certificate checked, except for a database on this same machine (local development and
      // tests), which has no certificate to check. DATABASE_SSL is no longer read.
      ssl: isLocalDatabase(url) ? false : { rejectUnauthorized: true },
    });
    return drizzlePg(pool, { schema });
  }
  return drizzleNeon(neon(url), { schema });
}

type Db = ReturnType<typeof drizzleNeon<typeof schema>>;

const globalForDb = globalThis as unknown as { __db?: Db };

// Typed as the neon flavour; the pg flavour is API-compatible for what we use.
export const db: Db = (globalForDb.__db ??= createDb() as unknown as Db);
