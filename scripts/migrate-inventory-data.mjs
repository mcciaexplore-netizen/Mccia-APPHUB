#!/usr/bin/env node
/**
 * Moves the standalone Inventory app's data into the hub's Inventory module: categories, vendors, items, and the stock history
 * (purchases → inward, issues → issue, returns → return, adjustments → adjust or recount).
 *
 *   OLD_DATABASE_URL=<the old Inventory app's database> DATABASE_URL=<the hub's database> node scripts/migrate-inventory-data.mjs           (dry run)
 *   OLD_DATABASE_URL=… DATABASE_URL=… node scripts/migrate-inventory-data.mjs --apply                                                    (writes)
 *
 * SAFE BY DESIGN
 *   - Dry run unless --apply: everything is done inside one transaction and then rolled back, printing exactly what would happen.
 *   - With --apply it is still ONE transaction: it all goes in, or (on any error) nothing does.
 *   - Idempotent: every row it creates gets an id derived from the old row's id, so a second run finds them and adds nothing.
 *   - It never changes or deletes anything already in the hub. An item that already exists in the hub under the same name (added by
 *     hand) is skipped, with its history, and listed as a warning. An item it migrated before keeps the hub's current stock.
 *   - The old database is only read.
 *   - Requests, purchase orders and maintenance tickets of the old app are NOT moved; neither are its users (people sign in with the hub).
 *
 * RUN IT ONCE, AT CUT-OVER: stop people using the old app first, then run the dry run, read it, then --apply. Each item's history is
 * rebuilt so its "quantity after" adds up to the old app's current stock; an "Opening balance (migrated)" movement makes up any part of
 * the stock the old history does not explain.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { Pool } = createRequire(path.join(ROOT, "package.json"))("pg");

const APPLY = process.argv.includes("--apply");
const OLD_URL = process.env.OLD_DATABASE_URL;
const NEW_URL = process.env.DATABASE_URL;
if (!OLD_URL || !NEW_URL) {
  console.error("Set OLD_DATABASE_URL (the old Inventory app's database) and DATABASE_URL (the hub's database).");
  process.exit(2);
}
if (OLD_URL === NEW_URL) {
  console.error("Refusing: OLD_DATABASE_URL and DATABASE_URL are the same database.");
  process.exit(2);
}
const host = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
const pool = (url) => new Pool({ connectionString: url, max: 2, ssl: ["localhost", "127.0.0.1", "::1"].includes(host(url)) ? false : { rejectUnauthorized: true } });
const oldDb = pool(OLD_URL), newDb = pool(NEW_URL);

/* ---------------------------------------------------------------- helpers */

// A stable UUID for each old row (name-based, like UUID v5), so a second run finds what the first one created.
function stableId(key) {
  const h = createHash("sha1").update(`mccia-inventory-migration:${key}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
// The old app writes times as India-time text: "2026-10-29 14:05:00", or a bare date "2026-10-29".
function istDate(s) {
  if (s == null || s === "") return null;
  const t = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return new Date(`${t}T00:00:00+05:30`);
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/.exec(t);
  if (m) return new Date(`${m[1]}T${m[2]}${m[3] ?? ":00"}+05:30`);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}
const paise = (rupees) => (rupees == null || Number.isNaN(Number(rupees)) ? null : Math.round(Number(rupees) * 100));
const clean = (s, max = 500) => { const t = (s ?? "").toString().trim(); return t ? t.slice(0, max) : null; };
const key = (s) => (s ?? "").toString().trim().toLowerCase();

const counts = { categories: [0, 0], vendors: [0, 0], items: [0, 0], movements: [0, 0], openings: 0 };
const warnings = [];
const warn = (w) => warnings.push(w);

/* ---------------------------------------------------------------- run */

async function main() {
  console.log(`Inventory data migration: ${APPLY ? "APPLY (writes to the hub)" : "DRY RUN (nothing is written; add --apply to write)"}`);
  console.log(`  from ${host(OLD_URL)}  →  to ${host(NEW_URL)}\n`);

  // Both sides must look right before anything is read in earnest.
  const hasNew = (await newDb.query(`select to_regclass('public.inventory_items') is not null and to_regclass('public.inventory_stock_movements') is not null as ok`)).rows[0].ok;
  if (!hasNew) throw new Error("The hub database has no Inventory tables. Run scripts/apply-0021-inventory-in-neon-console.sql there first.");
  const hasOld = (await oldDb.query(`select to_regclass('public.items') is not null and to_regclass('public.issues') is not null as ok`)).rows[0].ok;
  if (!hasOld) throw new Error("OLD_DATABASE_URL does not look like the old Inventory app's database (no items/issues tables).");

  console.log("Reading the old app…");
  const q = async (sql) => (await oldDb.query(sql)).rows;
  const tableExists = async (t) => (await oldDb.query(`select to_regclass($1) is not null as ok`, [`public.${t}`])).rows[0].ok;
  const old = {
    users: await q(`select id, name, email from users`),
    categories: await q(`select id, name from categories order by id`),
    vendors: (await tableExists("vendors")) ? await q(`select id, name, email, address, gstin, pan, created_at from vendors order by id`) : [],
    items: await q(`select * from items order by id`),
    purchases: (await tableExists("purchases")) ? await q(`select * from purchases order by id`) : [],
    issues: await q(`select * from issues order by id`),
    adjustments: (await tableExists("adjustments")) ? await q(`select * from adjustments order by id`) : [],
  };
  console.log(`  ${old.categories.length} categories, ${old.vendors.length} vendors, ${old.items.length} items, ${old.purchases.length} purchases, ${old.issues.length} issues, ${old.adjustments.length} adjustments\n`);

  const c = await newDb.connect();
  try {
    await c.query("begin");

    // People: an old user is matched to a hub user by email; otherwise their name is kept, marked "(old app)".
    const hubUsers = new Map((await c.query(`select id, name, lower(email) as email from users`)).rows.map((u) => [u.email, u]));
    const oldUsers = new Map(old.users.map((u) => [u.id, u]));
    const actor = (oldUserId) => {
      const u = oldUsers.get(oldUserId);
      if (!u) return { id: stableId("old-user:unknown"), name: "Old inventory app" };
      const hub = hubUsers.get(key(u.email));
      return hub ? { id: hub.id, name: hub.name } : { id: stableId(`old-user:${u.id}`), name: `${u.name} (old app)` };
    };
    const departments = new Map((await c.query(`select id, lower(name) as name from departments where kind = 'organisation'`)).rows.map((d) => [d.name, d.id]));

    // Categories and vendors: created under a stable id, or matched to one of the same name already in the hub.
    console.log("Categories…");
    const categoryId = new Map();
    for (const cat of old.categories) {
      const id = stableId(`category:${cat.id}`);
      const r = await c.query(`insert into inventory_categories (id, name) values ($1, $2) on conflict do nothing`, [id, clean(cat.name, 120)]);
      counts.categories[r.rowCount ? 0 : 1]++;
      const found = (await c.query(`select id from inventory_categories where id = $1 or lower(name) = lower($2) order by (id = $1) desc limit 1`, [id, clean(cat.name, 120)])).rows[0];
      categoryId.set(cat.id, found?.id ?? null);
    }
    console.log("Vendors…");
    const vendorByName = new Map();
    for (const v of old.vendors) {
      const id = stableId(`vendor:${v.id}`);
      const r = await c.query(
        `insert into inventory_vendors (id, name, email, address, gstin, pan, created_at) values ($1, $2, $3, $4, $5, $6, coalesce($7, now())) on conflict do nothing`,
        [id, clean(v.name, 120), clean(v.email, 200)?.toLowerCase() ?? null, clean(v.address), clean(v.gstin, 20)?.replace(/\s+/g, "").toUpperCase() ?? null,
          clean(v.pan, 15)?.replace(/\s+/g, "").toUpperCase() ?? null, istDate(v.created_at)],
      );
      counts.vendors[r.rowCount ? 0 : 1]++;
    }
    for (const v of (await c.query(`select id, lower(name) as name from inventory_vendors`)).rows) vendorByName.set(v.name, v.id);

    // Items: new ones are created with the old app's current stock; ones migrated before are left as the hub has them now.
    console.log("Items and their stock history…");
    const hubItemsByName = new Map((await c.query(`select id, lower(name) as name, quantity from inventory_items`)).rows.map((i) => [i.name, i]));
    for (const it of old.items) {
      const id = stableId(`item:${it.id}`);
      const name = clean(it.name, 120);
      const existing = hubItemsByName.get(key(name));
      if (existing && existing.id !== id) {
        warn(`Item "${name}" is already in the hub (added there by hand): skipped, with its history. Check its stock by hand.`);
        continue;
      }
      if (existing) {
        counts.items[1]++;
        if (Number(existing.quantity) !== Number(it.quantity)) warn(`Item "${name}" was migrated before; the hub now has ${existing.quantity}, the old app ${it.quantity}. The hub's figure was kept.`);
      } else {
        await c.query(
          `insert into inventory_items (id, name, category_id, unit, quantity, min_quantity, rate_paise, location, notes, default_vendor_id, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, coalesce($11, now()))`,
          [id, name, categoryId.get(it.category_id) ?? null, clean(it.unit, 20) ?? "Nos", Number(it.quantity) || 0, Number(it.min_quantity) || 0, paise(it.rate),
            clean(it.location, 120), clean(it.notes), vendorByName.get(key(it.vendor)) ?? null, istDate(it.created_at)],
        );
        counts.items[0]++;
      }

      // The item's history, oldest first, then "quantity after" worked back from the old app's current stock.
      const events = [];
      for (const p of old.purchases.filter((x) => x.item_id === it.id)) {
        const vendorId = vendorByName.get(key(p.vendor)) ?? null;
        events.push({ id: stableId(`purchase:${p.id}`), kind: "inward", delta: Number(p.quantity), at: istDate(p.purchased_at), actor: actor(p.created_by),
          vendorId, ratePaise: paise(p.rate), challanNo: clean(p.challan_no, 60), reason: `Purchase (migrated)${!vendorId && clean(p.vendor) ? `; vendor: ${clean(p.vendor, 120)}` : ""}` });
      }
      for (const s of old.issues.filter((x) => x.item_id === it.id)) {
        const issueId = stableId(`issue:${s.id}`);
        const deptId = departments.get(key(s.department)) ?? null;
        const common = { issuedToName: clean(s.issued_to, 120), deptId, eventName: clean(s.event, 120) };
        events.push({ id: issueId, kind: "issue", delta: -Number(s.quantity), at: istDate(s.issued_at), actor: actor(s.issued_by), consumed: !!Number(s.consumed),
          reason: `Issue (migrated)${!deptId && clean(s.department) ? `; department: ${clean(s.department, 120)}` : ""}`, ...common });
        if (s.returned_at && !Number(s.consumed)) {
          events.push({ id: stableId(`issue-return:${s.id}`), kind: "return", delta: Number(s.quantity), at: istDate(s.returned_at), actor: actor(s.issued_by),
            issueOf: issueId, reason: "Return (migrated)", ...common });
        }
      }
      for (const a of old.adjustments.filter((x) => x.item_id === it.id)) {
        events.push({ id: stableId(`adjustment:${a.id}`), kind: /count/i.test(a.reason ?? "") ? "recount" : "adjust", delta: Number(a.delta), at: istDate(a.created_at),
          actor: actor(a.created_by), reason: [clean(a.reason, 200), clean(a.note, 280)].filter(Boolean).join(": ") || "Adjustment (migrated)" });
      }
      for (const e of events) if (!e.at) { warn(`A ${e.kind} of "${name}" has no readable date; it is placed at the migration time.`); e.at = new Date(); }
      events.sort((x, y) => x.at - y.at);

      let after = Number(it.quantity) || 0;
      for (let i = events.length - 1; i >= 0; i--) { events[i].after = after; after -= events[i].delta; }
      const opening = after; // what the stock was before the first event the old app remembers
      if (opening !== 0) {
        const at = events.length ? new Date(events[0].at.getTime() - 1000) : istDate(it.created_at) ?? new Date();
        events.unshift({ id: stableId(`opening:${it.id}`), kind: "adjust", delta: opening, after: opening, at, actor: { id: stableId("old-user:unknown"), name: "Old inventory app" },
          reason: "Opening balance (migrated): stock the old app's history does not explain" });
      }
      if (events.some((e) => e.after < 0)) warn(`Item "${name}": its old history goes below zero at some point; it was moved as it is.`);

      for (const e of events) {
        const r = await c.query(
          `insert into inventory_stock_movements (id, item_id, kind, delta, quantity_after, reason, issued_to_name, issued_to_department_id, event_name, issue_id, consumed,
             vendor_id, challan_no, rate_paise, actor_user_id, actor_name, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) on conflict (id) do nothing`,
          [e.id, id, e.kind, e.delta, e.after, e.reason, e.issuedToName ?? null, e.deptId ?? null, e.eventName ?? null, e.issueOf ?? null, e.consumed ?? false,
            e.vendorId ?? null, e.challanNo ?? null, e.ratePaise ?? null, e.actor.id, e.actor.name, e.at],
        );
        counts.movements[r.rowCount ? 0 : 1]++;
        if (r.rowCount && e.id === stableId(`opening:${it.id}`)) counts.openings++;
      }
    }

    // One line in the hub's audit log when anything was written.
    const wrote = counts.categories[0] + counts.vendors[0] + counts.items[0] + counts.movements[0];
    if (wrote > 0) {
      await c.query(`insert into access_audit (actor_id, actor_name, action, target_type, target_label, details) values (null, 'Migration script', 'inventory.data_migrated', 'system', 'Old inventory app', $1)`,
        [JSON.stringify({ categories: counts.categories[0], vendors: counts.vendors[0], items: counts.items[0], movements: counts.movements[0], openingBalances: counts.openings })]);
    }
    await c.query(APPLY ? "commit" : "rollback");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }

  const line = (label, [added, present]) => console.log(`  ${label.padEnd(16)} ${String(added).padStart(5)} ${APPLY ? "added" : "would be added"}   ${String(present).padStart(5)} already there`);
  console.log(`\nSummary (${APPLY ? "written" : "dry run: nothing was written"})`);
  line("Categories", counts.categories);
  line("Vendors", counts.vendors);
  line("Items", counts.items);
  line("Stock movements", counts.movements);
  if (counts.openings) console.log(`  (${counts.openings} of those movements are opening balances)`);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning${warnings.length === 1 ? "" : "s"}:`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (!APPLY) console.log("\nThis was a dry run. Read it, then run again with --apply to write.");
}

main()
  .catch((e) => { console.error(`\nStopped: ${e.message}${APPLY ? "\nNothing was written (the whole run is one transaction)." : ""}`); process.exitCode = 1; })
  .finally(async () => { await oldDb.end(); await newDb.end(); });
