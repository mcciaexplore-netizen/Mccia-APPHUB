// Historical import end to end, with a real export from the old system: preview, category decisions, import, the tickets in the lists and
// opened, read-only (no decisions, no queue, no events, no notifications), re-import skips everything, Undo, and nothing else touched.
//
// It signs in as the Support Admin (HEAD_ADMIN_EMAIL / HEAD_ADMIN_PASSWORD, as for the hub suite), adds two people and two expense
// categories of its own, and removes everything it made at the end. Test databases only:
//   E2E_HIST_CONFIRM=yes E2E_HIST_FILE="/path/All Expenditures.json" E2E_BASE_URL=http://localhost:3000 DATABASE_URL=... \
//   HEAD_ADMIN_EMAIL=... HEAD_ADMIN_PASSWORD=... node tests/e2e/approvals-historical.mjs
import { createRequire } from "node:module";
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";

if (process.env.E2E_HIST_CONFIRM !== "yes") { console.error("This test imports and removes records. Set E2E_HIST_CONFIRM=yes against a TEST database."); process.exit(2); }
if (/neon\.tech/.test(process.env.DATABASE_URL ?? "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("DATABASE_URL points at Neon. Use a test database."); process.exit(2); }
const FILE = process.env.E2E_HIST_FILE;
if (!FILE || !fs.existsSync(FILE)) { console.error("Set E2E_HIST_FILE to a Zoho 'All Expenditures' JSON export."); process.exit(2); }
// E2E_SHOTS=<folder>: also saves screenshots of the preview, the list and an opened ticket there.
const SHOTS = process.env.E2E_SHOTS;
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {}); };
const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const ADMIN = (process.env.HEAD_ADMIN_EMAIL ?? "").toLowerCase(), ADMIN_PW = process.env.HEAD_ADMIN_PASSWORD ?? "";
if (!ADMIN || !ADMIN_PW) { console.error("Set HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD (the server's Support Admin)."); process.exit(2); }

const req = createRequire(import.meta.url);
const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL });
const q = (t, v = []) => pool.query(t, v).then((r) => r.rows);
const one = async (t, v) => (await q(t, v))[0];
const hash = (pw) => { const s = randomBytes(16); return `scrypt$16384$${s.toString("base64")}$${scryptSync(pw, s, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
let pass = 0, fail = 0;
/** Deep equality that ignores key order (Postgres jsonb stores keys in its own order). */
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const check = (name, good, detail = "") => { if (good) pass++; else fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name}${good || detail === "" ? "" : `  (${String(detail).slice(0, 300)})`}`); };

const source = JSON.parse(fs.readFileSync(FILE, "utf8")).All_Expenditures;
const byId = new Map(source.map((r) => [r.ID, r]));
const count = (f) => source.filter(f).length;

// ---------------------------------------------------------------- setup (everything made here is removed at the end)
const made = { users: [], categories: [], counters: [] };
const existingImports = Number((await one("select count(*)::int n from apr_historical_records")).n);
if (existingImports) { console.error(`The database already has ${existingImports} historical tickets: use a clean test database.`); process.exit(2); }
const before = {
  requests: Number((await one("select count(*)::int n from apr_requests")).n),
  events: Number((await one("select count(*)::int n from apr_approval_events")).n),
  notes: Number((await one("select count(*)::int n from apr_notifications")).n),
  hubNotes: Number((await one("select count(*)::int n from hub_notifications").catch(() => ({ n: 0 }))).n),
  steps: Number((await one("select count(*)::int n from apr_request_steps")).n),
  counters: (await q("select key from apr_counters")).map((r) => r.key),
};
for (const [name, email] of [["Neeraj Thakur", "neerajt@mcciapune.com"], ["Gauri Fellow", "gauri.fellow@mcciapune.com"]]) {
  if (await one("select id from users where lower(email) = $1", [email])) { console.error(`${email} already exists in this database: use a clean test database.`); process.exit(2); }
  const u = await one("insert into users (name, email, password_hash) values ($1, $2, $3) returning id", [name, email, hash("Unused-Pass-1")]);
  made.users.push(u.id);
}
for (const name of ["Repairs and Maintenance", "Administrative Expenses"]) {
  const c = await one("insert into apr_categories (name, active, sort) values ($1, true, 9000) on conflict do nothing returning id", [name]);
  if (c) made.categories.push(c.id);
}

const pw = req("playwright-core");
const br = await pw.chromium.launch({ channel: "chrome", headless: true }).catch(() => pw.chromium.launch({ headless: true }));
const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
const p = await ctx.newPage();
/** The import page is in Setup & Configuration: leaving it locks Administrator again, so coming back asks for the password. */
const openImport = async () => {
  await p.goto(BASE + "/approvals/admin/import");
  if (new URL(p.url()).pathname === "/unlock") { await p.fill("input[name=password]", ADMIN_PW); await p.click("button[type=submit]"); await p.waitForURL((u) => u.pathname === "/approvals/admin/import", { timeout: 30000 }); }
};
const api = (method, path, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; }, [method, path, body]);

try {
  await p.goto(BASE + "/login"); await p.fill("input[name=email]", ADMIN); await p.fill("input[name=password]", ADMIN_PW);
  await p.click("button[type=submit]"); await p.waitForURL((u) => u.pathname === "/", { timeout: 60000 });
  await openImport();
  check("the Historical Import page opens for the Support Admin", (await p.locator("h2", { hasText: "Historical Import" }).count()) === 1);
  check("it is in the Approval System menu", (await p.locator("nav a[href='/approvals/admin/import']").count()) >= 1);
  await p.goto(BASE + "/approvals/admin/historical-import");
  check("its first address leads to it", new URL(p.url()).pathname === "/approvals/admin/import", p.url());

  // ---------------------------------------------------------------- preview
  await p.setInputFiles("[data-testid=hist-file]", FILE);
  await p.locator("[data-testid=hist-preview]").waitFor({ timeout: 60000 });
  const num = async (id) => Number((await p.locator(`[data-testid=${id}] p`).nth(1).innerText()).trim());
  check("preview: every record in the file is counted", (await num("hist-total")) === source.length, await num("hist-total"));
  check("preview: all ready (no errors, nothing imported yet)", (await num("hist-ready")) === source.length && (await num("hist-errors")) === 0 && (await num("hist-duplicates")) === 0);
  const statusText = await p.locator("[data-testid=hist-statuses]").innerText();
  for (const s of ["Approved", "Recommend", "Pending", "Rejected"]) check(`preview: ${s} count shown as in the file`, new RegExp(`${s}\\s+${count((r) => r.Status === s)}\\b`).test(statusText), statusText);
  const unmatched = await p.locator("[data-testid=hist-unmatched]").innerText();
  check("preview: a requester whose email belongs to someone else is not linked, and says why", /gauri\.fellow@mcciapune\.com belongs to Gauri Fellow in the hub, but the record names/.test(unmatched), unmatched);
  check("preview: Neeraj (same email and name) is linked, so not in the unmatched list", !/neerajt@mcciapune\.com ·/.test(unmatched.replace(/\n/g, " ")) || !/Neeraj Thakur · neerajt/.test(unmatched));
  const cats = await p.locator("[data-testid=hist-categories] tbody tr").count();
  check("preview: every distinct source category listed", cats === new Set(source.map((r) => r.Category.trim().toLowerCase())).size, cats);
  check("preview: an exact name is matched by itself", /Repairs and Maintenance[\s\S]*Matched/i.test(await p.locator("[data-testid=hist-categories]").innerText()));
  check("preview: Import is held until every category is decided", await p.locator("[data-testid=hist-import]").isDisabled());
  check("preview: nothing written yet", Number((await one("select count(*)::int n from apr_requests")).n) === before.requests);

  // Decide: "Admin Expenses" under the existing "Administrative Expenses", every other unknown one added as a historical category.
  const choices = p.locator("[data-testid=hist-category-choice]");
  const n = await choices.count();
  for (let i = 0; i < n; i++) {
    const label = await choices.nth(i).getAttribute("aria-label");
    if (/Admin Expenses$/.test(label)) {
      const adminId = (await one("select id from apr_categories where name = 'Administrative Expenses'")).id;
      await choices.nth(i).selectOption(adminId);
    } else await choices.nth(i).selectOption("__create__");
  }
  check("preview: Import is enabled once decided", await p.locator("[data-testid=hist-import]").isEnabled());
  await shot("hist-preview");

  // ---------------------------------------------------------------- import
  await p.locator("[data-testid=hist-import]").click();
  await p.locator("[data-testid=hist-result]").waitFor({ timeout: 180000 });
  const rec = await p.locator("[data-testid=hist-reconcile]").innerText();
  check("import: every record imported, and the reconciliation adds up", new RegExp(`${source.length} records in the file: ${source.length} imported, 0 skipped, 0 failed\\. Every record is accounted for\\.`).test(rec), rec);

  const rows = await q(`select r.*, h.source_status, h.legacy_id hl, h.source_record, h.requester, h.category, h.timeline, h.notes, d.category_id, d.nature_of_expenditure, c.name cat_name, c.active cat_active
    from apr_requests r join apr_historical_records h on h.request_id = r.id join apr_expenditure_details d on d.request_id = r.id join apr_categories c on c.id = d.category_id`);
  check("db: one ticket per record", rows.length === source.length, rows.length);
  check("db: every ticket has the historical status", rows.every((r) => r.status === "historical"));
  check("db: every source record kept exactly", rows.every((r) => same(r.source_record, byId.get(r.hl))), rows.find((r) => !same(r.source_record, byId.get(r.hl)))?.hl);
  check("db: the source status kept exactly (Recommend stays Recommend)", rows.every((r) => r.source_status === byId.get(r.hl).Status) && rows.filter((r) => r.source_status === "Recommend").length === count((r) => r.Status === "Recommend"));
  check("db: legacy id kept with its system", rows.every((r) => r.legacy_id === `zoho:${r.hl}`));
  check("db: no steps, no approver, step 0 of 0", rows.every((r) => r.current_approver_user_id === null && r.current_step === 0 && r.total_steps === 0) && Number((await one("select count(*)::int n from apr_request_steps")).n) === before.steps);
  check("db: no events written (the live timeline is untouched)", Number((await one("select count(*)::int n from apr_approval_events")).n) === before.events);
  check("db: nobody was notified", Number((await one("select count(*)::int n from apr_notifications")).n) === before.notes && Number((await one("select count(*)::int n from hub_notifications").catch(() => ({ n: 0 }))).n) === before.hubNotes);
  check("db: all of the DG expenditure form (EXP), numbered per financial year", rows.every((r) => r.type === "expenditure_large" && new RegExp(`^EXP-${r.financial_year}-\\d{4}$`).test(r.request_no)));
  check("db: numbers unique", new Set(rows.map((r) => r.request_no)).size === rows.length);
  const fyOk = rows.every((r) => { const d = new Date(new Date(r.requested_at).getTime() + 330 * 60000); const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return r.financial_year === `${y}-${String((y + 1) % 100).padStart(2, "0")}`; });
  check("db: financial year from the date of request (April to March, IST)", fyOk);
  const ordered = Object.values(rows.reduce((m, r) => ((m[r.financial_year] ??= []).push(r), m), {})).every((list) => {
    const s = [...list].sort((a, b) => a.request_no.localeCompare(b.request_no));
    return s.every((r, i) => i === 0 || new Date(s[i - 1].requested_at) <= new Date(r.requested_at));
  });
  check("db: numbers follow the date of request within each year", ordered);
  const z = rows.find((r) => r.hl === "192778000002062013");
  check("db: date read as Indian time (28-Oct-2026 14:49:47 IST)", new Date(z.requested_at).toISOString() === "2026-10-28T09:19:47.000Z", z.requested_at);
  check("db: amounts to paise exactly (2339508.12)", Number(rows.find((r) => byId.get(r.hl).Amount === "2339508.12").amount_paise) === 233950812);
  check("db: missing amounts stay empty, not zero", rows.filter((r) => r.amount_paise === null).length === count((r) => !r.Amount.trim()));
  check("db: description kept in full", rows.every((r) => (r.nature_of_expenditure ?? "") === byId.get(r.hl).Nature_of_Expenditure.trim()));
  check("db: Recommend and Pending have no decision time", rows.filter((r) => ["Recommend", "Pending"].includes(r.source_status)).every((r) => r.decided_at === null));
  check("db: a decision time only where Zoho shows a final status with a DG time", rows.every((r) => (r.decided_at !== null) === (["Approved", "Rejected"].includes(r.source_status) && !!byId.get(r.hl).DG)));
  check("db: no approver ever invented in the timeline", rows.every((r) => r.timeline.every((t) => t.key === "submitted" || t.actor === null)));
  check("db: timeline only has what the source has", rows.every((r) => r.timeline.length === 1 + (byId.get(r.hl).Recommended ? 1 : 0) + (byId.get(r.hl).DG ? 1 : 0)));
  const neeraj = made.users[0], gauri = made.users[1];
  check("db: linked only where email and name agree (neerajt@ → Neeraj Thakur)", rows.filter((r) => r.requester_user_id === neeraj).length === count((r) => r.Email === "neerajt@mcciapune.com" && r.Name.trim() === "Neeraj Thakur"));
  check("db: never attributed to the wrong person (gauri.fellow@ records naming others)", rows.filter((r) => r.requester_user_id === gauri).length === 0);
  check("db: unlinked records keep the source's name and email, owned by nobody", rows.filter((r) => r.requester_user_id === "00000000-0000-0000-0000-000000000000").every((r) => r.requester_name === byId.get(r.hl).Name.trim() && r.requester_email === byId.get(r.hl).Email.trim().toLowerCase()));
  check("db: original category and its ID kept", rows.every((r) => r.category.name === byId.get(r.hl).Category && r.category.sourceId === byId.get(r.hl)["Category.ID"]));
  check("db: exact match filed under the existing category", rows.filter((r) => r.category.name === "Repairs and Maintenance").every((r) => r.cat_name === "Repairs and Maintenance"));
  check("db: Admin Expenses filed under Administrative Expenses", rows.filter((r) => r.category.name === "Admin Expenses").every((r) => r.cat_name === "Administrative Expenses"));
  const adminCat = await one("select aliases from apr_categories where name = 'Administrative Expenses'");
  check("db: and remembered as its old spelling", adminCat.aliases.includes("Admin Expenses"), adminCat.aliases);
  const newCats = await q("select id, name, active from apr_categories where id <> all($1::uuid[]) and name not in ('Repairs and Maintenance','Administrative Expenses')", [made.categories]);
  made.categories.push(...newCats.map((c) => c.id));
  check("db: new historical categories are inactive (never offered on the live forms)", newCats.length > 0 && newCats.every((c) => !c.active), newCats.map((c) => `${c.name}:${c.active}`).join(", "));
  check("db: a trailing space in the source name is not copied into the hub's name", newCats.every((c) => c.name === c.name.trim()));
  check("db: the import is in the audit log", Number((await one("select count(*)::int n from apr_admin_audit where entity = 'historical_import'")).n) === 1);
  const batch = await one("select * from apr_import_batches order by created_at desc limit 1");
  check("db: the uploaded file is kept as it was", same(batch.raw.All_Expenditures, source));
  for (const key of (await q("select key from apr_counters")).map((r) => r.key)) if (!before.counters.includes(key)) made.counters.push(key);

  // ---------------------------------------------------------------- in the lists
  await p.goto(BASE + "/approvals/expenditures/all?status=historical");
  await p.waitForLoadState("networkidle");
  const listText = await p.locator("main").innerText();
  check("list: All Expenditures shows them, filtered by Historical", /Historical · (Approved|Recommend|Pending|Rejected)/.test(listText), listText.slice(0, 200));
  await shot("hist-list");
  check("list: the Status filter offers Historical", (await p.locator("select option[value=historical]").count()) >= 1);
  const recommendPill = await p.locator(".status-pill", { hasText: "Historical · Recommend" }).count();
  check("list: the old status is visible on each row (Historical · Recommend)", recommendPill > 0);
  await p.goto(BASE + `/approvals/expenditures/all?q=${z.hl}`);
  await p.waitForLoadState("networkidle");
  check("list: found by its Zoho ID", (await p.locator(`a:has-text("${z.request_no}")`).count()) >= 1);
  await p.goto(BASE + "/approvals/expenditures/pending");
  await p.waitForLoadState("networkidle");
  check("list: none of them among Pending Expenditures (not live)", (await p.locator(".status-pill", { hasText: "Historical" }).count()) === 0);

  // ---------------------------------------------------------------- one ticket
  const rc = rows.find((r) => r.source_status === "Recommend");
  await p.goto(BASE + `/approvals/requests/${rc.id}`);
  await p.waitForLoadState("networkidle");
  const page = await p.locator("main").innerText();
  await shot("hist-ticket");
  check("ticket: opens with the normal details", page.includes(rc.request_no) && page.includes("Nature of Expenditure"));
  check("ticket: says it is historical, from Zoho, with its ID and status", /Historical record from Zoho Creator \(ID \d+, status there: Recommend\)/.test(page));
  check("ticket: Historical Approval Details section", (await p.locator("[data-testid=historical-details] summary", { hasText: "Historical Approval Details" }).count()) === 1);
  check("ticket: shows the category ID there", page.includes(rc.category.sourceId));
  check("ticket: historical timeline, with who acted not recorded", (await p.locator("[data-testid=historical-timeline] li").count()) === rc.timeline.length && page.includes("who acted is not recorded"));
  check("ticket: says no DG action is recorded", (await p.locator("[data-testid=historical-no-dg]").count()) === 1);
  check("ticket: no Approve or Reject controls", (await p.getByRole("button", { name: /^(Approve|Reject|Recommend to DG|Final approve)/ }).count()) === 0);
  check("ticket: no Withdraw", (await p.getByRole("button", { name: /Withdraw/ }).count()) === 0);
  check("ticket: the original record is there for administrators", (await p.locator("[data-testid=historical-source]").count()) === 1);
  const dec = await api("POST", `/api/approvals/requests/${rc.id}/decision`, { action: "approve", comment: null });
  check("ticket: the decision API refuses it", dec.status >= 400 && dec.status < 500, `${dec.status} ${JSON.stringify(dec.json)}`);
  const wd = await api("POST", `/api/approvals/requests/${rc.id}/withdraw`, {});
  check("ticket: the withdraw API refuses it", wd.status >= 400 && wd.status < 500, `${wd.status} ${JSON.stringify(wd.json)}`);
  check("ticket: still historical, still no events", (await one("select status from apr_requests where id = $1", [rc.id])).status === "historical" && Number((await one("select count(*)::int n from apr_approval_events where request_id = $1", [rc.id])).n) === 0);

  // ---------------------------------------------------------------- import again: nothing new
  await openImport();
  await p.setInputFiles("[data-testid=hist-file]", FILE);
  await p.locator("[data-testid=hist-preview]").waitFor({ timeout: 60000 });
  check("re-import: every record shown as already imported", (await num("hist-duplicates")) === source.length && (await num("hist-ready")) === 0);
  check("re-import: Import disabled", await p.locator("[data-testid=hist-import]").isDisabled());
  const again = await api("POST", "/api/approvals/historical/import", { fileName: "again.json", text: fs.readFileSync(FILE, "utf8"), decisions: {} });
  check("re-import: the server refuses too", again.status === 400, `${again.status} ${JSON.stringify(again.json)}`);
  check("re-import: still one ticket per record", Number((await one("select count(*)::int n from apr_historical_records")).n) === source.length);

  // Not for everyone: someone who is not an Approvals admin cannot preview or import.
  const other = await br.newContext(); const op = await other.newPage();
  const userPw = "Plain-User-Pass-1";
  await q("update users set password_hash = $2 where id = $1", [neeraj, hash(userPw)]);
  await op.goto(BASE + "/login"); await op.fill("input[name=email]", "neerajt@mcciapune.com"); await op.fill("input[name=password]", userPw);
  await op.click("button[type=submit]"); await op.waitForURL((u) => u.pathname === "/", { timeout: 60000 });
  const denied = await op.evaluate(async () => (await fetch("/api/approvals/historical/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: "x.json", text: "{}" }) })).status);
  check("access: a plain user cannot use the import", denied === 403 || denied === 404, denied);
  await op.goto(BASE + "/approvals/my-requests");
  await other.close();

  // ---------------------------------------------------------------- undo
  await openImport();
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-testid=hist-undo]").first().click();
  await p.waitForFunction(() => document.body.innerText.includes("Undone"), null, { timeout: 60000 });
  check("undo: every imported ticket removed", Number((await one("select count(*)::int n from apr_requests where status = 'historical'")).n) === 0 && Number((await one("select count(*)::int n from apr_historical_records")).n) === 0);
  check("undo: the import stays in the history, marked undone", !!(await one("select undone_at from apr_import_batches where id = $1", [batch.id])).undone_at);
  check("undo: nothing else removed", Number((await one("select count(*)::int n from apr_requests")).n) === before.requests);
  check("undo: in the audit log", Number((await one("select count(*)::int n from apr_admin_audit where entity = 'historical_import' and action = 'delete'")).n) === 1);
} catch (e) {
  check("test crashed", false, e?.stack ?? e);
} finally {
  await br.close();
  await q("delete from apr_requests where status = 'historical'").catch(() => {});
  await q("delete from apr_historical_records").catch(() => {});
  await q("delete from apr_import_batches").catch(() => {});
  await q("delete from apr_admin_audit where entity = 'historical_import' or (entity = 'category' and summary like '%historical import%')").catch(() => {});
  if (made.categories.length) await q("delete from apr_categories where id = any($1::uuid[])", [made.categories]).catch((e) => console.error("categories", e.message));
  if (made.counters.length) await q("delete from apr_counters where key = any($1)", [made.counters]);
  if (made.users.length) { await q("delete from activity_log where user_id = any($1::uuid[])", [made.users]).catch(() => {}); await q("delete from login_attempts where email in ('neerajt@mcciapune.com','gauri.fellow@mcciapune.com')").catch(() => {}); await q("delete from users where id = any($1::uuid[])", [made.users]); }
  const left = Number((await one("select count(*)::int n from apr_requests")).n);
  check("cleanup: the database is as it was", left === before.requests, `${left} vs ${before.requests}`);
  await pool.end();
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
