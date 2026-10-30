# Moving the hub's database from Neon to Supabase

The hub and everything in it (Approvals, Inventory) share one Postgres database. This is the checklist for moving it. Nothing in the
application changes: it already speaks plain Postgres (`DB_DRIVER=pg`), so the move is new environment variables plus the data.

Neon is never changed by any of this. Until the last step, production keeps running on Neon exactly as today.

## The files

| File | What it is |
|---|---|
| `scripts/migrate-to-supabase.sql` | The whole structure: 48 tables, 14 enums, 50 foreign keys, 53 indexes, in parent-before-child order, grouped by module. Safe to run twice. Also creates `drizzle.__drizzle_migrations` and removes Supabase's public API roles' rights. No data. |
| `scripts/export-neon-data.mjs` | Reads every row from the database in `DATABASE_URL` (Neon) in one read-only snapshot and writes `scripts/neon-data-export.sql`: INSERTs in foreign-key order, the migration history, the file contents, and the serial counters. Prints the row count of every table. |
| `scripts/neon-data-export.sql` | The output. **Personal data and password hashes**: in `.gitignore`, never commit or share it, delete it when done. |

Both were tested on a copy: the structure is identical to what migrations 0000–0022 produce, and every table (including 10 MB of
uploaded files) came back byte for byte, with the serial counters continuing past the copied rows.

## Connection strings

Copy them from Supabase → **Connect** (top of the project). Each looks like this; the host differs per project (`aws-0-…` or
`aws-1-…`, and the region), so copy, do not type:

| Use | Port | Format |
|---|---|---|
| **The hub on Vercel** (`DATABASE_URL`) | **6543** (transaction pooler) | `postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres` |
| **Scripts from your Mac** (load the schema and data, `npm run db:migrate`) | **5432** (session pooler) | `postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres` |
| Direct connection (avoid) | 5432 | `postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`: IPv6 only, which Vercel and most home networks cannot reach |

- The user name on the pooler is `postgres.[PROJECT-REF]`, not `postgres`.
- An `?sslmode=…` on `DATABASE_URL` is removed by the hub (node-postgres would let it override the hub's TLS setting and then
  refuse Supabase's certificate with SELF_SIGNED_CERT_IN_CHAIN).
- A password with `@ : / ? #` in it must be URL-encoded in the string (or choose one without them).

## Environment variables in Vercel (Production)

| Name | Value |
|---|---|
| `DATABASE_URL` | the transaction pooler string (port 6543) |
| `DB_DRIVER` | `pg` |
| `DB_POOL_MAX` | optional, leave unset (5 connections per server instance) |

Everything else (`AUTH_SECRET`, `SUPPORT_ADMIN_*`, `SMTP_*`, `SSO_PRIVATE_KEY`, …) stays as it is. `DATABASE_SSL` is no longer read
(it can stay or be removed).

TLS: with `DB_DRIVER=pg`, the connection to a remote database is always encrypted, but the server's certificate is not checked,
because Supabase signs it with its own authority that Node does not know (otherwise: SELF_SIGNED_CERT_IN_CHAIN). Only a database on
the same machine, for local development, is unencrypted.

## Security checklist

- [ ] **Turn off the Data API**: Supabase → Project Settings → **Data API** (older dashboards: Settings → API) → switch it off.
      The hub never uses it; with it on, tables would be reachable over HTTP with the public key.
- [ ] **Row Level Security stays off.** The hub checks every permission itself and connects as the database owner. Supabase's
      Security Advisor will list "RLS disabled" for each table: expected, as long as the Data API is off.
- [ ] `scripts/migrate-to-supabase.sql` has also removed the rights of Supabase's `anon` and `authenticated` roles on every table
      (a second lock behind the Data API switch).
- [ ] The database password lives only in Vercel and your local `.env.local`. Never in git, chat or screenshots.
- [ ] Delete `scripts/neon-data-export.sql` once the move is verified.

## The move, step by step

Choose a quiet time (evening or weekend). Anything people do in the hub between the export (step 4) and the switch (step 7) stays in
Neon and is not copied, so keep that window short and tell people.

1. **Create the Supabase project** (region close to Vercel's, Mumbai `ap-south-1` for India). Note the database password.
2. **Data API off** (see the checklist).
3. **Create the structure.** From the project folder, with the **session pooler** string (port 5432):
   ```
   /opt/homebrew/opt/postgresql@17/bin/psql "<session pooler string>" -v ON_ERROR_STOP=1 -f scripts/migrate-to-supabase.sql
   ```
   Check in Supabase → SQL Editor (should be 48 and 14):
   ```sql
   SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
          (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e') AS enums;
   ```
4. **Export from Neon** (only reads Neon). `.env.local` must hold the Neon `DATABASE_URL`:
   ```
   node --env-file=.env.local scripts/export-neon-data.mjs
   ```
   Keep the row counts it prints.
5. **Load the data** into Supabase (one transaction: all or nothing; loading twice adds nothing):
   ```
   /opt/homebrew/opt/postgresql@17/bin/psql "<session pooler string>" -v ON_ERROR_STOP=1 -f scripts/neon-data-export.sql
   ```
   The file is too big for the SQL Editor; use `psql` as above.
6. **Verify** in Supabase → SQL Editor:
   - Row counts match what step 4 printed (also listed at the end of the export file):
     ```sql
     SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;   -- approximate; for one exact: SELECT count(*) FROM users;
     ```
   - **Migration history copied** (should be 23):
     ```sql
     SELECT count(*) FROM drizzle.__drizzle_migrations;
     ```
   - **Serial counters reset** (each `next_id` must be greater than `max_id`):
     ```sql
     SELECT 'access_audit' t, (SELECT max(id) FROM access_audit) max_id, (SELECT last_value FROM access_audit_id_seq) next_id
     UNION ALL SELECT 'activity_log', (SELECT max(id) FROM activity_log), (SELECT last_value FROM activity_log_id_seq)
     UNION ALL SELECT 'login_attempts', (SELECT max(id) FROM login_attempts), (SELECT last_value FROM login_attempts_id_seq)
     UNION ALL SELECT 'apr_approval_events', (SELECT max(id) FROM apr_approval_events), (SELECT last_value FROM apr_approval_events_id_seq);
     ```
   - **Uploaded files (apr_file_chunks) copied correctly.** Run this in BOTH Neon and Supabase; the three numbers must be equal:
     ```sql
     SELECT count(*) AS chunks, sum(length(data)) AS bytes, md5(string_agg(md5(data), '' ORDER BY file_id, idx)) AS fingerprint FROM apr_file_chunks;
     ```
7. **Switch** Vercel → Project → Settings → Environment Variables (Production): set the four variables above, then **Redeploy**.
8. **Smoke test** on the live site: sign in, open an application card, Administrator → People, an Approvals request with an
   attachment (open the file), Inventory items. Then a write: e.g. mark a notification read.

**If anything is wrong:** Vercel → Deployments → the previous deployment → **Instant Rollback**. It runs with the old variables, so the
hub is back on Neon at once (Neon was never changed). Anything written in Supabase after the switch would then need copying back,
so decide quickly. Keep the Neon project for a few weeks before deleting it.

## After the move

- New migrations: the `scripts/apply-00xx-….sql` files are pasted into **Supabase → SQL Editor** instead of Neon (same scripts).
  Or `npm run db:migrate` with the session pooler string (port 5432) in `DATABASE_URL`; never the transaction pooler (6543).
- Local development is unchanged (`DB_DRIVER=pg` with a local database).
