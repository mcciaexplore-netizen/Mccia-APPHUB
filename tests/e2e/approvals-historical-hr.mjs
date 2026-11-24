// Historical import of Zoho HR records end to end, with the real "All Hr" export: preview (missing dates, amounts, emails, file names),
// category decisions, import, the tickets in the HR lists and opened, read-only, who may see them (HR Admin yes, Expense Admin no), a
// recovered file attached later, re-import skips everything, the live HR workflow still routes to the HR Admin, Undo, nothing else touched.
//
// It signs in as the Support Admin (HEAD_ADMIN_EMAIL / HEAD_ADMIN_PASSWORD), adds its own HR Admin, Expense Admin, Super Admin, a plain user
// and two HR request types, and removes everything it made at the end. Test databases only:
//   E2E_HIST_CONFIRM=yes E2E_HIST_HR_FILE="/path/All Hr.json" E2E_BASE_URL=http://localhost:3000 DATABASE_URL=... \
//   HEAD_ADMIN_EMAIL=... HEAD_ADMIN_PASSWORD=... node tests/e2e/approvals-historical-hr.mjs
import { createRequire } from "node:module";
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";

if (process.env.E2E_HIST_CONFIRM !== "yes") { console.error("This test imports and removes records. Set E2E_HIST_CONFIRM=yes against a TEST database."); process.exit(2); }
if (/neon\.tech|supabase\.co/.test(process.env.DATABASE_URL ?? "") && process.env.E2E_ALLOW_REMOTE !== "yes") { console.error("DATABASE_URL points at a hosted database. Use a test database."); process.exit(2); }
const FILE = process.env.E2E_HIST_HR_FILE;
if (!FILE || !fs.existsSync(FILE)) { console.error("Set E2E_HIST_HR_FILE to a Zoho 'All Hr' JSON export."); process.exit(2); }
const SHOTS = process.env.E2E_SHOTS;
const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const ADMIN = (process.env.HEAD_ADMIN_EMAIL ?? "").toLowerCase(), ADMIN_PW = process.env.HEAD_ADMIN_PASSWORD ?? "";
if (!ADMIN || !ADMIN_PW) { console.error("Set HEAD_ADMIN_EMAIL and HEAD_ADMIN_PASSWORD (the server's Support Admin)."); process.exit(2); }

const req = createRequire(import.meta.url);
const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL });
const q = (t, v = []) => pool.query(t, v).then((r) => r.rows);
const one = async (t, v) => (await q(t, v))[0];
const n = async (t, v) => Number((await one(t, v)).n);
const hash = (pw) => { const s = randomBytes(16); return `scrypt$16384$${s.toString("base64")}$${scryptSync(pw, s, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
let pass = 0, fail = 0;
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const check = (name, good, detail = "") => { if (good) pass++; else fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name}${good || detail === "" ? "" : `  (${String(detail).slice(0, 300)})`}`); };

const TEXT = fs.readFileSync(FILE, "utf8");
const source = JSON.parse(TEXT).All_Hr;
const byId = new Map(source.map((r) => [r.ID, r]));
const count = (f) => source.filter(f).length;
/** Zoho's "28-Nov-2023 15:48:50", Indian time, as an instant. */
const ist = (t) => { const M = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }; const m = /^(\d+)-(\w{3})-(\d{4}) (\d+):(\d+):(\d+)$/.exec(t); return new Date(Date.UTC(+m[3], M[m[2]], +m[1], +m[4], +m[5], +m[6]) - 330 * 60000).toISOString(); };
const fyOf = (iso) => { const d = new Date(new Date(iso).getTime() + 330 * 60000); const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };

// ---------------------------------------------------------------- setup (everything made here is removed at the end)
const made = { users: [], hrCategories: [], counters: [], requests: [] };
if (await n("select count(*)::int n from apr_historical_records")) { console.error("The database already has historical tickets: use a clean test database."); process.exit(2); }
if (await n("select count(*)::int n from users where role in ('hr_admin','expense_admin','super_admin') and is_active")) { console.error("This database already has an HR, Expense or Super Admin: use a clean test database."); process.exit(2); }
const before = {
  requests: await n("select count(*)::int n from apr_requests"),
  events: await n("select count(*)::int n from apr_approval_events"),
  notes: await n("select count(*)::int n from apr_notifications"),
  steps: await n("select count(*)::int n from apr_request_steps"),
  expenseCats: await n("select count(*)::int n from apr_categories"),
  counters: (await q("select key from apr_counters")).map((r) => r.key),
};
const PW = "Role-Test-Pass-1";
const people = {};
for (const [key, name, email, role] of [
  ["hr", "Test HR Admin", "hist.hr.admin@mcciapune.com", "hr_admin"], ["exp", "Test Expense Admin", "hist.exp.admin@mcciapune.com", "expense_admin"],
  ["dg", "Test Director General", "hist.dg@mcciapune.com", "super_admin"],
  // Same name as a Zoho requester, but the export has no email: must never be linked by name alone.
  ["vaidehi", "Vaidehi Marathe", "hist.vaidehi@mcciapune.com", "member"],
]) {
  if (await one("select id from users where lower(email) = $1", [email])) { console.error(`${email} already exists: use a clean test database.`); process.exit(2); }
  const u = await one("insert into users (name, email, password_hash, role) values ($1, $2, $3, $4) returning id", [name, email, hash(PW), role]);
  made.users.push(u.id); people[key] = { id: u.id, email };
}
for (const name of ["Celebration", "Offer Letters"]) {
  const c = await one("insert into apr_hr_categories (name, active, sort) values ($1, true, 9000) returning id", [name]);
  made.hrCategories.push(c.id);
}

const pw = req("playwright-core");
const br = await pw.chromium.launch({ channel: "chrome", headless: true }).catch(() => pw.chromium.launch({ headless: true }));
const signIn = async (email, password) => {
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login"); await page.fill("input[name=email]", email); await page.fill("input[name=password]", password);
  await page.click("button[type=submit]"); await page.waitForURL((u) => u.pathname === "/", { timeout: 60000 });
  return { ctx, page };
};
const callAs = (page, method, path, body) => page.evaluate(async ([m, u, b]) => {
  const r = await fetch(u, { method: m, headers: b === undefined ? undefined : { "Content-Type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j };
}, [method, path, body]);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {}); };

const admin = await signIn(ADMIN, ADMIN_PW);
const p = admin.page;
const openImport = async () => {
  await p.goto(BASE + "/approvals/admin/import");
  if (new URL(p.url()).pathname === "/unlock") { await p.fill("input[name=password]", ADMIN_PW); await p.click("button[type=submit]"); await p.waitForURL((u) => u.pathname === "/approvals/admin/import", { timeout: 30000 }); }
};
const api = (m, u, b) => callAs(p, m, u, b);
const listRows = async (page, path) => { await page.goto(BASE + path); await page.waitForLoadState("networkidle"); return page.locator("main table tbody tr:has(a[href^='/approvals/requests/'])"); };

try {
  // ---------------------------------------------------------------- preview
  await openImport();
  await p.setInputFiles("[data-testid=hist-file]", FILE);
  await p.locator("[data-testid=hist-preview]").waitFor({ timeout: 60000 });
  const num = async (id) => Number((await p.locator(`[data-testid=${id}] p`).nth(1).innerText()).trim());
  check("preview: recognised as HR requests by its contents", /Zoho Creator HR approvals \(All Hr\)[\s\S]*They become HR requests/.test(await p.locator("[data-testid=hist-source]").innerText()));
  check("preview: all 12 records counted", (await num("hist-total")) === source.length && source.length === 12, await num("hist-total"));
  check("preview: all ready, none failed or duplicate", (await num("hist-ready")) === 12 && (await num("hist-errors")) === 0 && (await num("hist-duplicates")) === 0);
  const statusText = await p.locator("[data-testid=hist-statuses]").innerText();
  check("preview: status breakdown as in the file (Approved 10, Rejected 2)", /Approved\s+10\b/.test(statusText) && /Rejected\s+2\b/.test(statusText), statusText);
  check("preview: missing request dates counted", (await num("hist-missing-dates")) === count((r) => !r.Date_of_Request), await num("hist-missing-dates"));
  check("preview: missing amounts counted", (await num("hist-missing-amounts")) === count((r) => !r.Amount), await num("hist-missing-amounts"));
  check("preview: missing emails counted (all 12)", (await num("hist-missing-emails")) === 12);
  check("preview: file references counted", (await num("hist-attachments")) === count((r) => r.File_upload), await num("hist-attachments"));
  check("preview: no requester linked (no email to verify anyone)", (await num("hist-unlinked")) === 12);
  const catTable = await p.locator("[data-testid=hist-categories]").innerText();
  check("preview: all 5 source categories listed", (await p.locator("[data-testid=hist-categories] tbody tr").count()) === 5);
  check("preview: an exact HR request type is matched by itself (Celebration)", /Celebration[\s\S]*Matched/i.test(catTable));
  check("preview: HR wording for the choice", (await p.locator("[data-testid=hist-category-choice] option", { hasText: "historical HR request type" }).count()) >= 1);
  check("preview: Import held until categories are decided", await p.locator("[data-testid=hist-import]").isDisabled());
  check("preview: nothing written yet", (await n("select count(*)::int n from apr_requests")) === before.requests);
  const choices = p.locator("[data-testid=hist-category-choice]");
  for (let i = 0; i < (await choices.count()); i++) {
    const label = await choices.nth(i).getAttribute("aria-label");
    if (/Letter Draft\(Offer Letter\)$/.test(label)) await choices.nth(i).selectOption(made.hrCategories[1]);
    else await choices.nth(i).selectOption("__create__");
  }
  await shot(p, "hr-preview");

  // ---------------------------------------------------------------- import
  await p.locator("[data-testid=hist-import]").click();
  await p.locator("[data-testid=hist-result]").waitFor({ timeout: 180000 });
  const rec = await p.locator("[data-testid=hist-reconcile]").innerText();
  check("import: 12 imported, every record accounted for", /12 records in the file: 12 imported, 0 skipped, 0 failed\. Every record is accounted for\./.test(rec), rec);

  const rows = await q(`select r.*, h.source_system, h.source_status, h.legacy_id hl, h.source_record, h.requester, h.category, h.timeline, h.source_dates, h.extra, h.notes,
      d.first_name, d.last_name, d.description, c.name cat_name, c.active cat_active
    from apr_requests r join apr_historical_records h on h.request_id = r.id join apr_hr_details d on d.request_id = r.id join apr_hr_categories c on c.id = d.hr_category_id`);
  const row = (id) => rows.find((r) => r.hl === id);
  check("db: one HR ticket per record", rows.length === 12 && rows.every((r) => r.type === "hr"), rows.length);
  check("db: all historical, from Zoho HR", rows.every((r) => r.status === "historical" && r.source_system === "zoho_creator_hr"));
  check("db: Zoho ID kept as the legacy ID", rows.every((r) => r.legacy_id === `zoho-hr:${r.hl}` && byId.has(r.hl)));
  check("db: every source record kept exactly", rows.every((r) => same(r.source_record, byId.get(r.hl))));
  check("db: statuses kept exactly", rows.every((r) => r.source_status === byId.get(r.hl).Status));
  check("db: no steps, approver, events or notifications", rows.every((r) => r.current_approver_user_id === null && r.total_steps === 0)
    && (await n("select count(*)::int n from apr_request_steps")) === before.steps && (await n("select count(*)::int n from apr_approval_events")) === before.events
    && (await n("select count(*)::int n from apr_notifications")) === before.notes);
  check("db: the requester's name kept exactly, no email invented", rows.every((r) => r.requester_name === byId.get(r.hl).Name && r.requester_email === ""));
  check("db: nobody linked by name alone (Vaidehi Marathe is a hub user, not linked)", rows.every((r) => r.requester_user_id === "00000000-0000-0000-0000-000000000000"));
  check("db: no employee name made up", rows.every((r) => r.first_name === "" && r.last_name === ""));
  const dated = rows.filter((r) => byId.get(r.hl).Date_of_Request), undated = rows.filter((r) => !byId.get(r.hl).Date_of_Request);
  check("db: dated records keep their date (IST) and year, numbered HR-<year>-nnnn",
    dated.length === 4 && dated.every((r) => new Date(r.requested_at).toISOString() === ist(byId.get(r.hl).Date_of_Request) && r.financial_year === fyOf(r.requested_at) && new RegExp(`^HR-${r.financial_year}-\\d{4}$`).test(r.request_no)));
  check("db: undated records get no year and the undated series", undated.length === 8 && undated.every((r) => r.financial_year === null && /^HR-UNDATED-\d{4}$/.test(r.request_no)));
  check("db: an undated record is listed by its earliest stage time, marked as such",
    undated.every((r) => { const s = byId.get(r.hl); const e = [s.Satavisha_Natu, s.DG].filter(Boolean).map(ist).sort()[0]; return new Date(r.requested_at).toISOString() === e && r.source_dates.some((f) => f.kind === "listed_by" && f.value); }));
  check("db: numbers unique", new Set(rows.map((r) => r.request_no)).size === 12);
  check("db: amounts exact, missing ones empty", rows.every((r) => { const a = byId.get(r.hl).Amount; return a ? Number(r.amount_paise) === Math.round(Number(a) * 100) : r.amount_paise === null; }));
  check("db: only an approved record with a DG time has a decision time", rows.every((r) => (r.decided_at !== null) === (r.source_status === "Approved" && !!byId.get(r.hl).DG)));
  check("db: no approver named in any timeline", rows.every((r) => r.timeline.every((t) => t.key === "submitted" || t.actor === null)));
  check("db: a stage appears only when Zoho has its time", rows.every((r) => r.timeline.filter((t) => t.key !== "submitted").length === (byId.get(r.hl).Satavisha_Natu ? 1 : 0) + (byId.get(r.hl).DG ? 1 : 0)));
  check("db: file names kept as references, no file", rows.every((r) => { const f = byId.get(r.hl).File_upload; const a = r.extra.filter((x) => x.kind === "attachment"); return f ? a.length === 1 && a[0].value === f && !a[0].attachmentId : a.length === 0; }));
  check("db: Celebration filed under the existing type", rows.filter((r) => r.category.name === "Celebration").every((r) => r.cat_name === "Celebration"));
  check("db: Letter Draft(Offer Letter) filed under Offer Letters, original kept", rows.filter((r) => r.category.name === "Letter Draft(Offer Letter)").every((r) => r.cat_name === "Offer Letters") && rows.some((r) => r.category.name === "Letter Draft(Offer Letter)"));
  const newTypes = await q("select id, name, active from apr_hr_categories where id <> all($1::uuid[])", [made.hrCategories]);
  made.hrCategories.push(...newTypes.map((c) => c.id));
  check("db: the other 3 added as inactive HR request types (never on the live form)", newTypes.length === 3 && newTypes.every((c) => !c.active), newTypes.map((c) => `${c.name}:${c.active}`).join(", "));
  check("db: no expense category touched", (await n("select count(*)::int n from apr_categories")) === before.expenseCats);
  check("db: the import is in the audit log", (await n("select count(*)::int n from apr_admin_audit where entity = 'historical_import'")) === 1);
  for (const key of (await q("select key from apr_counters")).map((r) => r.key)) if (!before.counters.includes(key)) made.counters.push(key);

  // ---------------------------------------------------------------- the HR list
  let list = await listRows(p, "/approvals/hr/all?status=historical");
  check("list: All Hr shows all 12, filtered by Historical", (await list.count()) === 12, await list.count());
  check("list: undated ones say Not recorded", (await p.locator("[data-testid=date-not-recorded]").count()) === 8);
  check("list: original status on the rows", (await p.locator(".status-pill", { hasText: "Historical · Rejected" }).count()) === 2);
  await shot(p, "hr-list");
  list = await listRows(p, "/approvals/hr/all?q=192778000000066053");
  check("list: found by its Zoho ID", (await list.count()) === 1);
  list = await listRows(p, "/approvals/expenditures/all?status=historical");
  check("list: none among expenditures", (await list.count()) === 0);
  list = await listRows(p, "/approvals/hr/pending");
  check("list: none among Pending HR requests", (await list.count()) === 0);

  // ---------------------------------------------------------------- an opened ticket (undated, with a file)
  const t = row("192778000000066053");
  await p.goto(BASE + `/approvals/requests/${t.id}`); await p.waitForLoadState("networkidle");
  let page = await p.locator("main").innerText();
  await shot(p, "hr-ticket");
  check("ticket: normal HR details, under the requester's name", page.includes(t.request_no) && page.includes("HR request") && page.includes("Vaidehi Marathe") && page.includes("Expenses"));
  check("ticket: historical notice with Zoho ID and status", page.includes("Historical record from Zoho Creator (ID 192778000000066053, status there: Approved)"));
  check("ticket: request date shown as not recorded", (await p.locator("[data-testid=request-date-not-recorded]").count()) >= 1 && /Not recorded in Zoho Creator/.test(page));
  check("ticket: what it is listed by, said so", (await p.locator("[data-testid=historical-listed-by]").innerText()).trim() === "28-Nov-2023 15:48:50");
  check("ticket: the HR-stage and DG-stage times as written", page.includes("28-Nov-2023 15:52:44") && /HR stage, Satavisha_Natu field/.test(page));
  check("ticket: says the name is not the employee", page.includes("The source does not name the employee it was about."));
  check("ticket: file name shown, not available", (await p.locator("[data-testid=historical-file]").innerText()).includes("1701165739733_Trip_November_2023_.docx") && (await p.locator("[data-testid=historical-file-missing]").count()) === 1);
  check("ticket: no download link for the missing file", (await p.locator("a[href^='/api/approvals/files/']").count()) === 0);
  check("ticket: timeline has the stages, nobody named", (await p.locator("[data-testid=historical-timeline] li").count()) === 3 && page.includes("HR-stage action recorded") && page.includes("who acted is not recorded"));
  check("ticket: no Approve / Reject / Withdraw", (await p.getByRole("button", { name: /^(Approve|Reject|Recommend to DG|Final approve|Withdraw)/ }).count()) === 0);
  check("ticket: the original record for the Support Admin", (await p.locator("[data-testid=historical-source]").count()) === 1);
  check("ticket: the Support Admin is pointed to where a recovered copy is attached", (await p.locator("[data-testid=recover-link]").getAttribute("href")) === "/approvals/admin/import#hist-files");
  const dec = await api("POST", `/api/approvals/requests/${t.id}/decision`, { action: "approve", comment: "" });
  check("ticket: the decision API refuses it", dec.status >= 400 && dec.status < 500 && !/comment/.test(JSON.stringify(dec.json)), `${dec.status} ${JSON.stringify(dec.json)}`);
  const r2 = row("192778000001348005");
  await p.goto(BASE + `/approvals/requests/${r2.id}`); await p.waitForLoadState("networkidle");
  page = await p.locator("main").innerText();
  check("ticket (rejected, dated): its date is the request date, not marked missing", (await p.locator("[data-testid=request-date-not-recorded]").count()) === 0 && page.includes("22-Jan-2026 18:06:44"));
  check("ticket (rejected): no DG action, and the stage of the rejection is not guessed", page.includes("Zoho does not record at which stage it was rejected.") && (await p.locator("[data-testid=historical-no-dg]").count()) === 1);

  // ---------------------------------------------------------------- a recovered file, attached later (on the Historical Import page)
  await openImport();
  const fileRows = p.locator("[data-testid=hist-file-row]");
  check("files: the import page lists every file the records name", (await fileRows.count()) === count((r) => r.File_upload), await fileRows.count());
  const fr = p.locator("[data-testid=hist-file-row][data-legacy-id='192778000000066053']");
  check("files: shown as not available", (await fr.innerText()).includes("Not available") && (await fr.innerText()).includes(t.request_no));
  const wrongStart = await api("POST", "/api/approvals/uploads", { fileName: "x.pdf", size: 9 });
  await p.evaluate(async (id) => fetch(`/api/approvals/uploads/${id}?i=0`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new TextEncoder().encode("%PDF-1.4\n") }), wrongStart.json.fileId);
  const wrongRef = await api("POST", `/api/approvals/historical/requests/${t.id}/attachments`, { fileId: wrongStart.json.fileId, reference: "something-else.pdf" });
  check("recover: a file name the source does not give is refused", wrongRef.status === 400, `${wrongRef.status} ${JSON.stringify(wrongRef.json)}`);
  await fr.locator("[data-testid=recover-open]").click();
  await fr.locator("[data-testid=recover-form] input[type=file]").setInputFiles({ name: "Trip_November_2023.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% recovered copy for the e2e test\n") });
  await fr.locator("[data-testid=recover-attach]").click({ timeout: 30000 });
  await p.locator("[data-testid=hist-file-row][data-legacy-id='192778000000066053'] [data-testid=hist-file-recovered]").waitFor({ timeout: 30000 }).catch(() => {});
  const attRow = await one("select a.id, a.file_name from apr_attachments a where a.request_id = $1", [t.id]);
  const att = { json: { attachmentId: attRow?.id } };
  check("recover: attached to its ticket, against its Zoho file name", !!attRow && attRow.file_name === "Trip_November_2023.pdf"
    && (await one("select extra from apr_historical_records where request_id = $1", [t.id])).extra.some((f) => f.kind === "attachment" && f.attachmentId === attRow.id));
  check("recover: the import page shows it recovered", (await p.locator("[data-testid=hist-file-row][data-legacy-id='192778000000066053'] [data-testid=hist-file-recovered]").count()) === 1);
  const second = await api("POST", "/api/approvals/uploads", { fileName: "y.pdf", size: 9 });
  await p.evaluate(async (id) => fetch(`/api/approvals/uploads/${id}?i=0`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new TextEncoder().encode("%PDF-1.4\n") }), second.json.fileId);
  const again = await api("POST", `/api/approvals/historical/requests/${t.id}/attachments`, { fileId: second.json.fileId, reference: "1701165739733_Trip_November_2023_.docx" });
  check("recover: not twice", again.status === 409, again.status);
  check("recover: in the audit log", (await n("select count(*)::int n from apr_admin_audit where entity = 'historical_import' and action = 'update'")) === 1);
  await p.goto(BASE + `/approvals/requests/${t.id}`); await p.waitForLoadState("networkidle");
  check("recover: the ticket shows it recovered and downloadable", (await p.locator("[data-testid=historical-file-recovered]").count()) === 1 && (await p.locator(`a[href='/api/approvals/files/${attRow?.id}']`).count()) === 1);
  check("recover: still historical, still no events", (await one("select status from apr_requests where id = $1", [t.id])).status === "historical" && (await n("select count(*)::int n from apr_approval_events where request_id = $1", [t.id])) === 0);

  // ---------------------------------------------------------------- who may see them
  const hrA = await signIn(people.hr.email, PW);
  list = await listRows(hrA.page, "/approvals/hr/all?status=historical");
  check("access: the HR Admin sees the 12 in All Hr", (await list.count()) === 12, await list.count());
  await hrA.page.goto(BASE + `/approvals/requests/${t.id}`); await hrA.page.waitForLoadState("networkidle");
  check("access: the HR Admin opens one, without the original JSON or the attach control",
    (await hrA.page.locator("[data-testid=historical-details]").count()) === 1 && (await hrA.page.locator("[data-testid=historical-source]").count()) === 0 && (await hrA.page.locator("[data-testid=recover-open]").count()) === 0);
  check("access: the HR Admin can download the recovered file", (await callAs(hrA.page, "POST", "/api/approvals/historical/preview", { fileName: "x.json", text: "{}" })).status >= 403
    && (await hrA.page.evaluate(async (u) => (await fetch(u)).status, `/api/approvals/files/${att.json.attachmentId}`)) === 200);
  list = await listRows(hrA.page, "/approvals/review/hr/pending");
  check("access: nothing historical in the HR Admin's queue", (await hrA.page.locator(".status-pill", { hasText: "Historical" }).count()) === 0);
  const expA = await signIn(people.exp.email, PW);
  list = await listRows(expA.page, "/approvals/hr/all");
  check("access: the Expense Admin sees no historical HR ticket", (await list.count()) === 0, await list.count());
  const expOpen = await expA.page.goto(BASE + `/approvals/requests/${t.id}`);
  check("access: the Expense Admin cannot open one", expOpen.status() === 404, expOpen.status());
  check("access: nor download its file", (await expA.page.evaluate(async (u) => (await fetch(u)).status, `/api/approvals/files/${att.json.attachmentId}`)) >= 400);
  const plain = await signIn(people.vaidehi.email, PW);
  check("access: Vaidehi (same name, not linked) cannot open it", (await plain.page.goto(BASE + `/approvals/requests/${t.id}`)).status() === 404);
  check("access: a plain user cannot import or attach", (await callAs(plain.page, "POST", `/api/approvals/historical/requests/${t.id}/attachments`, { fileId: second.json.fileId, reference: "x" })).status >= 403);

  // ---------------------------------------------------------------- the live HR workflow is unchanged
  const live = await callAs(plain.page, "POST", "/api/approvals/requests", { kind: "hr", firstName: "Live", lastName: "Check", hrCategoryId: made.hrCategories[0], description: "e2e live request" });
  if (live.json?.id) made.requests.push(live.json.id);
  const lr = live.json?.id ? await one("select * from apr_requests where id = $1", [live.json.id]) : null;
  check("live: a new HR request is pending with the HR Admin, step 1 of 2", live.status === 201 && lr?.status === "pending" && lr.current_approver_user_id === people.hr.id && lr.total_steps === 2, `${live.status} ${JSON.stringify(live.json)}`);
  check("live: numbered in the current year's series, not the undated one", !!lr && new RegExp(`^HR-${lr.financial_year}-\\d{4}$`).test(lr.request_no), lr?.request_no);
  list = await listRows(hrA.page, "/approvals/review/hr/pending");
  check("live: it is in the HR Admin's queue", (await hrA.page.locator(`a:has-text("${lr?.request_no}")`).count()) >= 1);
  const hrDec = await callAs(hrA.page, "POST", `/api/approvals/requests/${lr.id}/decision`, { action: "approve", comment: "" });
  const lr2 = await one("select * from apr_requests where id = $1", [lr.id]);
  check("live: the HR Admin's approval sends it on to the DG", hrDec.status === 200 && lr2.status === "pending" && lr2.current_approver_user_id === people.dg.id, `${hrDec.status} ${JSON.stringify(hrDec.json)}`);
  for (const c of [hrA, expA, plain]) await c.ctx.close();

  // ---------------------------------------------------------------- import again: nothing new
  await openImport();
  await p.setInputFiles("[data-testid=hist-file]", FILE);
  await p.locator("[data-testid=hist-preview]").waitFor({ timeout: 60000 });
  check("re-import: all 12 already imported, Import disabled", (await num("hist-duplicates")) === 12 && (await num("hist-ready")) === 0 && (await p.locator("[data-testid=hist-import]").isDisabled()));
  const re = await api("POST", "/api/approvals/historical/import", { fileName: "again.json", text: TEXT, decisions: {} });
  check("re-import: the server refuses too; still 12", re.status === 400 && (await n("select count(*)::int n from apr_historical_records")) === 12, re.status);
  const exp = await api("POST", "/api/approvals/historical/preview", { fileName: "e.json", text: JSON.stringify({ All_Expenditures: [{ ID: "1", Name: "A", Email: "", Date_of_Request: "01-Apr-2026 10:00:00", Status: "Approved", Category: "X", Amount: "1.00" }] }) });
  check("expenditure exports still recognised as expenditures", exp.status === 200 && exp.json?.preview?.sourceKey === "zoho_expenditures" && exp.json.preview.form === "expenditure", JSON.stringify(exp.json).slice(0, 200));

  // ---------------------------------------------------------------- undo
  p.once("dialog", (d) => d.accept());
  await p.locator("[data-testid=hist-undo]").first().click();
  await p.waitForFunction(() => document.body.innerText.includes("Undone"), null, { timeout: 60000 });
  check("undo: all 12 removed (with the recovered file's attachment), the live request kept",
    (await n("select count(*)::int n from apr_requests where status = 'historical'")) === 0 && (await n("select count(*)::int n from apr_requests where id = $1", [lr.id])) === 1);
} catch (e) {
  check("test crashed", false, e?.stack ?? e);
} finally {
  await br.close();
  await q("delete from apr_requests where status = 'historical'").catch(() => {});
  await q("delete from apr_notifications where request_id = any($1::uuid[])", [made.requests]).catch(() => {});
  await q("delete from apr_approval_events where request_id = any($1::uuid[])", [made.requests]).catch(() => {});
  if (made.requests.length) await q("delete from apr_requests where id = any($1::uuid[])", [made.requests]).catch((e) => console.error("requests", e.message));
  await q("delete from apr_historical_records").catch(() => {});
  await q("delete from apr_import_batches").catch(() => {});
  await q("delete from apr_admin_audit where entity = 'historical_import' or (entity = 'hr_category' and summary like '%historical import%')").catch(() => {});
  if (made.hrCategories.length) await q("delete from apr_hr_categories where id = any($1::uuid[])", [made.hrCategories]).catch((e) => console.error("hr categories", e.message));
  for (const key of (await q("select key from apr_counters")).map((r) => r.key)) if (!before.counters.includes(key) && !made.counters.includes(key)) made.counters.push(key);
  if (made.counters.length) await q("delete from apr_counters where key = any($1)", [made.counters]);
  await q("delete from apr_files where uploaded_by = $1 and file_name in ('Trip_November_2023.pdf', 'x.pdf', 'y.pdf')", [(await one("select id from users where lower(email) = $1", [ADMIN]))?.id]).catch(() => {});
  if (made.users.length) {
    await q("delete from hub_notifications where user_id = any($1::uuid[])", [made.users]).catch(() => {});
    await q("delete from activity_log where user_id = any($1::uuid[])", [made.users]).catch(() => {});
    await q("delete from login_attempts where email like 'hist.%@mcciapune.com'").catch(() => {});
    await q("delete from users where id = any($1::uuid[])", [made.users]).catch((e) => console.error("users", e.message));
  }
  const left = await n("select count(*)::int n from apr_requests");
  check("cleanup: the database is as it was", left === before.requests, `${left} vs ${before.requests}`);
  await pool.end();
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
