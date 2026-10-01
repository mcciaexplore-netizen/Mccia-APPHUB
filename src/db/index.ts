import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * The single place that knows which Postgres driver is active.
 * DB_DRIVER=neon (default) | pg. Everything else imports `db` from here.
 * Both drivers expose the same query-builder API. Note: neon-http has no
 * interactive transactions, so app code must not rely on db.transaction().
 */
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  if ((process.env.DB_DRIVER ?? "neon") === "pg") {
    const pool = new Pool({
      connectionString: url,
      max: 5,
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: false }
          : false,
    });
    return drizzlePg(pool, { schema });
  }
  return drizzleNeon(neon(url), { schema });
}

type Db = ReturnType<typeof drizzleNeon<typeof schema>>;

const globalForDb = globalThis as unknown as { __db?: Db };

// Typed as the neon flavour; the pg flavour is API-compatible for what we use.
export const db: Db = (globalForDb.__db ??= createDb() as unknown as Db);
