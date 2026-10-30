#!/usr/bin/env node
/**
 * Exports every row of the hub's database (today: Neon) as INSERT statements, for loading into the new Supabase database after
 * scripts/migrate-to-supabase.sql has created the tables. See docs/SUPABASE-MIGRATION.md.
 *
 *   node --env-file=.env.local scripts/export-neon-data.mjs            (reads DATABASE_URL; writes scripts/neon-data-export.sql)
 *
 * SAFE BY DESIGN
 *   - Only reads: everything runs in one READ ONLY transaction, so the database refuses any write. It is also one snapshot, so every
 *     table is exported as of the same moment, even while people are using the hub.
 *   - Every table in the public schema, plus drizzle.__drizzle_migrations (the list of applied migrations), in foreign-key order:
 *     a table comes after the tables it points to. A row that points to its own table (users.reporting_manager_id) is first inserted
 *     without that link, which is filled in once all rows of the table are in.
 *   - Values are written in Postgres's own text form, so what goes in comes out the same: uploaded files (bytea in apr_file_chunks)
 *     as hex, timestamps to the microsecond, arrays, jsonb and enums as they are.
 *   - The output file is ONE transaction (all of it loads, or none of it does), every INSERT has ON CONFLICT DO NOTHING (loading it
 *     twice adds nothing), and at the end every serial counter is set past the highest id, so new rows do not collide.
 *
 * THE OUTPUT HOLDS EVERYTHING: people's emails, password hashes, uploaded files. It is in .gitignore; never commit or share it, and delete
 * it once the migration is done. Load it with:  psql "<Supabase URL, port 5432>" -v ON_ERROR_STOP=1 -f scripts/neon-data-export.sql
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { Client } = createRequire(path.join(ROOT, "package.json"))("pg");
const OUT = path.join(ROOT, "scripts", "neon-data-export.sql");
const BATCH = 500; // rows per INSERT
const BATCH_BINARY = 4; // rows per INSERT for a table with a bytea column (a file chunk is up to 3 MB)

const URL_ = process.env.DATABASE_URL;
if (!URL_) {
  console.error("Set DATABASE_URL (the database to export, today Neon), for example: node --env-file=.env.local scripts/export-neon-data.mjs");
  process.exit(2);
}
const host = (() => { try { return new URL(URL_).hostname; } catch { return ""; } })();
const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);

const ident = (s) => `"${s.replaceAll('"', '""')}"`;
const lit = (s) => `'${s.replaceAll("'", "''")}'`;

const db = new Client({ connectionString: URL_, ssl: local ? false : { rejectUnauthorized: process.env.DATABASE_SSL !== "true" } });
let out;
try {
  await db.connect();
  await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  // Fixed text forms, whatever the server's defaults are.
  await db.query("SET LOCAL TimeZone = 'UTC'; SET LOCAL DateStyle = 'ISO'; SET LOCAL IntervalStyle = 'postgres'; SET LOCAL bytea_output = 'hex'; SET LOCAL extra_float_digits = 3");

  // The tables: public, and drizzle's migration list if there is one.
  const { rows: tableRows } = await db.query(`
    select c.oid::int as oid, n.nspname as schema, c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and (n.nspname = 'public' or (n.nspname = 'drizzle' and c.relname = '__drizzle_migrations'))
    order by n.nspname = 'drizzle', c.relname`);
  const tables = new Map(tableRows.map((t) => [t.oid, { ...t, q: `${ident(t.schema)}.${ident(t.name)}`, label: t.schema === "public" ? t.name : `${t.schema}.${t.name}` }]));

  // Columns (no generated ones), primary keys, serial counters, foreign keys.
  const { rows: cols } = await db.query(`
    select a.attrelid::int as oid, a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
           pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) is not null as serial
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where a.attrelid = any($1::oid[]) and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
    order by a.attrelid, a.attnum`, [[...tables.keys()]]);
  const { rows: cons } = await db.query(`
    select conrelid::int as oid, confrelid::int as ref, contype,
           array(select a.attname from unnest(conkey) k join pg_attribute a on a.attrelid = conrelid and a.attnum = k)::text[] as cols
    from pg_constraint where conrelid = any($1::oid[]) and contype in ('p', 'f')`, [[...tables.keys()]]);
  for (const t of tables.values()) {
    t.cols = cols.filter((c) => c.oid === t.oid);
    t.pk = cons.find((c) => c.oid === t.oid && c.contype === "p")?.cols ?? t.cols.map((c) => c.name);
    t.deps = new Set(cons.filter((c) => c.oid === t.oid && c.contype === "f" && c.ref !== t.oid && tables.has(c.ref)).map((c) => c.ref));
    t.selfCols = cons.filter((c) => c.oid === t.oid && c.contype === "f" && c.ref === t.oid).flatMap((c) => c.cols);
    if (t.selfCols.length && t.pk.length !== 1) throw new Error(`${t.label} points to itself but has no single-column primary key`);
  }

  // Foreign-key order: a table after every table it points to (alphabetical among equals).
  const order = [];
  const left = new Map(tables);
  while (left.size) {
    const ready = [...left.values()].filter((t) => [...t.deps].every((d) => !left.has(d)));
    if (!ready.length) throw new Error(`Foreign keys form a loop between: ${[...left.values()].map((t) => t.label).join(", ")}`);
    for (const t of ready) { order.push(t); left.delete(t.oid); }
  }

  const expected = 48;
  const publicCount = order.filter((t) => t.schema === "public").length;
  if (publicCount !== expected)
    console.warn(`WARNING: ${publicCount} tables in public, the code has ${expected}. scripts/migrate-to-supabase.sql only creates the code's ${expected}; check the list below.`);

  out = fs.createWriteStream(OUT, { mode: 0o600 });
  const write = (s) => (out.write(s) ? undefined : new Promise((r) => out.once("drain", r)));
  await write(`-- AppHub data, exported ${new Date().toISOString()} by scripts/export-neon-data.mjs. ${order.length} tables, foreign-key order.\n` +
    `-- CONTAINS PERSONAL DATA AND PASSWORD HASHES. Never commit or share it; delete it after the migration.\n` +
    `-- Load AFTER scripts/migrate-to-supabase.sql:  psql "<Supabase URL, port 5432>" -v ON_ERROR_STOP=1 -f scripts/neon-data-export.sql\n` +
    `-- One transaction; safe to load twice (ON CONFLICT DO NOTHING).\n\n` +
    `BEGIN;\nSET LOCAL client_encoding = 'UTF8';\nSET LOCAL standard_conforming_strings = on;\nSET LOCAL TimeZone = 'UTC';\n`);

  const counts = [];
  for (const t of order) {
    const binary = t.cols.some((c) => c.type === "bytea");
    const size = binary ? BATCH_BINARY : BATCH;
    const colList = t.cols.map((c) => ident(c.name)).join(", ");
    // Each row as a ready-made VALUES tuple, in Postgres's own text form; a link to the same table is left out for now (NULL).
    const tuple = t.cols.map((c) => (t.selfCols.includes(c.name) ? "'NULL'" : `quote_nullable(${ident(c.name)}::text)`)).join(` || ', ' || `);
    const orderBy = t.pk.map(ident).join(", ");
    let n = 0;
    await write(`\n-- ${t.label}\n`);
    for (let offset = 0; ; offset += size) {
      const { rows } = await db.query(`select '(' || ${tuple} || ')' as v from ${t.q} order by ${orderBy} limit ${size} offset ${offset}`);
      if (!rows.length) break;
      await write(`INSERT INTO ${t.q} (${colList}) VALUES\n${rows.map((r) => r.v).join(",\n")}\nON CONFLICT DO NOTHING;\n`);
      n += rows.length;
      if (rows.length < size) break;
    }
    // Now that every row of the table is in, put back the links to the same table.
    for (const col of t.selfCols) {
      const pk = t.pk[0];
      const { rows } = await db.query(`select '(' || quote_literal(${ident(pk)}::text) || ', ' || quote_literal(${ident(col)}::text) || ')' as v from ${t.q} where ${ident(col)} is not null order by ${ident(pk)}`);
      for (let i = 0; i < rows.length; i += BATCH)
        await write(`UPDATE ${t.q} AS t SET ${ident(col)} = v.ref::uuid FROM (VALUES\n${rows.slice(i, i + BATCH).map((r) => r.v).join(",\n")}\n) AS v(id, ref) WHERE t.${ident(pk)} = v.id::uuid;\n`);
    }
    counts.push({ table: t.label, rows: n });
  }

  // Serial counters past the highest id, so the next new row does not collide with a copied one.
  await write(`\n-- Serial counters\n`);
  for (const t of order)
    for (const c of t.cols.filter((x) => x.serial))
      await write(`SELECT setval(pg_get_serial_sequence(${lit(t.q)}, ${lit(c.name)}), COALESCE((SELECT max(${ident(c.name)}) FROM ${t.q}), 0) + 1, false);\n`);

  await write(`\nCOMMIT;\n\n-- CHECK after loading: the row counts should match these.\n${counts.map((c) => `--   ${c.table.padEnd(34)} ${c.rows}`).join("\n")}\n`);
  await db.query("ROLLBACK");
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));

  const total = counts.reduce((s, c) => s + c.rows, 0);
  console.log(`Exported from ${host || "(unknown host)"} to scripts/neon-data-export.sql (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)\n`);
  for (const c of counts) console.log(`  ${c.table.padEnd(34)} ${String(c.rows).padStart(8)}`);
  console.log(`  ${"".padEnd(34, "-")} --------\n  ${`TOTAL (${counts.length} tables)`.padEnd(34)} ${String(total).padStart(8)}`);
  console.log("\nThe file holds personal data and password hashes: never commit or share it; delete it after the migration.");
} catch (e) {
  out?.destroy();
  if (out) fs.rmSync(OUT, { force: true });
  console.error(`Export failed, nothing written: ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
