/**
 * End-to-end test of the ERU module in a real browser: who may open its two sections (ERU at /eru for the team: App Staff are members, App
 * Admins are admins; ERU Admin at /eru/admin for admins), and the whole life of a document: a member creates a project, uploads a .docx
 * (converted for the editor, the original kept in storage), formats text, comments on a passage, switches track changes on and makes tracked
 * edits (and cannot switch it off); an admin accepts and rejects the changes; the .docx download carries the result. Then ERU Admin: the
 * dashboard, All Projects, Members (adding someone writes the hub's own lists) and Settings. Run against a site with ERU_ENABLED=true and
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY pointing at a storage (a local stub is fine):
 *   E2E_BASE_URL=http://localhost:3000 STORAGE_STUB=http://localhost:54400 node tests/e2e/eru.mjs
 * With the module switched off (ERU_ENABLED unset), E2E_ERU_OFF=yes checks instead that every page and route is a 404.
 *
 * It WRITES to the database the site uses, but only rows of people named "ZZE"/"zze-": people, two "ZZE" applications (URLs /eru,
 * /eru/admin) given to them, and the projects, documents and files they make. Everything is removed when it finishes (and at the start, if an
 * earlier run was interrupted), and it checks that every other eru_ project is exactly as before. It refuses a Neon database unless
 * E2E_ALLOW_NEON=yes.
 */
import { createRequire } from "node:module";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(ROOT + "/package.json");
req("dotenv").config({ path: ROOT + "/.env.local", quiet: true });
req("dotenv").config({ path: ROOT + "/.env", quiet: true });
const BASE = (process.env.E2E_BASE_URL || "").replace(/\/$/, "");
if (!BASE) { console.error("Set E2E_BASE_URL, for example: E2E_BASE_URL=http://localhost:3000 node tests/e2e/eru.mjs"); process.exit(2); }
if (/neon\.tech/i.test(process.env.DATABASE_URL || "") && process.env.E2E_ALLOW_NEON !== "yes") { console.error("Refusing: DATABASE_URL is a Neon database. Use a test database, or set E2E_ALLOW_NEON=yes for a Neon test branch."); process.exit(2); }
const STUB = (process.env.STORAGE_STUB || "").replace(/\/$/, "");

const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && extra !== "" ? "  -> " + String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 260) : ""}`); };
const section = (t) => console.log(`\n== ${t} ==`);
const finish = () => {
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
};

const rawSql = (() => {
  if ((process.env.DB_DRIVER ?? "neon") !== "pg") return req("@neondatabase/serverless").neon(process.env.DATABASE_URL);
  const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL, max: 4, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false });
  return async (strings, ...values) => (await pool.query(strings.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), values)).rows;
})();
const retry = async (fn, tries = 8, waitMs = 3000) => { let last; for (let i = 0; i < tries; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, waitMs)); } } throw last; };
const sql = (...a) => retry(() => rawSql(...a));
const playwright = req("playwright-core");
const launch = () => playwright.chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || "chrome", headless: true }).catch(() => playwright.chromium.launch({ headless: true }));
const poll = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 400)); } return v; };
const hash = (pw) => { const salt = randomBytes(16); return `scrypt$16384$${salt.toString("base64")}$${scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const PW = "zze-Test-pass-123";

/** A small Word file made with the docx package: a heading, a bold run, a bullet and a plain paragraph. */
async function sampleDocx() {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = req("docx");
  const doc = new Document({
    sections: [{ children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Pune Industry Outlook")] }),
      new Paragraph({ children: [new TextRun("Manufacturing output "), new TextRun({ text: "rose sharply", bold: true }), new TextRun(" in the second quarter.")] }),
      new Paragraph({ bullet: { level: 0 }, children: [new TextRun("Exports steady")] }),
      new Paragraph({ children: [new TextRun("Credit demand remains strong among small firms.")] }),
    ] }],
  });
  return Packer.toBuffer(doc);
}

const testPeople = async () => (await sql`select id from users where email like 'zze-%'`).map((r) => r.id);
const removeTestData = async () => {
  const people = await testPeople();
  if (people.length) {
    await sql`delete from eru_projects where created_by = any(${people})`;
    await sql`delete from eru_files where uploaded_by = any(${people})`;
    await sql`delete from eru_audit_logs where user_id = any(${people})`;
    await sql`delete from hub_notifications where user_id = any(${people})`;
    await sql`delete from activity_log where user_id = any(${people})`;
    await sql`delete from access_audit where actor_id = any(${people})`;
    await sql`delete from login_attempts where email like 'zze-%'`.catch(() => {});
  }
  await sql`delete from users where email like 'zze-%'`;
  for (const a of await sql`select id from apps where name like 'ZZE%'`) await sql`delete from activity_log where app_id = ${a.id}`;
  await sql`delete from apps where name like 'ZZE%'`;
  await sql`delete from departments where name like 'ZZE%'`;
};
const snap = async () => JSON.stringify(await sql`select id, status, updated_at from eru_projects where created_by not in (select id from users where email like 'zze-%') order by id`);

await removeTestData();
const before = await snap();

const [org] = await sql`insert into departments (kind, name, icon) values ('organisation', 'ZZE Research', 'Building') returning id`;
const person = async (name, email, role = "member") => (await sql`insert into users (name, email, password_hash, status, role, home_department_id) values (${name}, ${email}, ${hash(PW)}, 'approved', ${role}, ${org.id}) returning id`)[0];
const member = await person("ZZE Member Meena", "zze-member@gmail.com");
const admin = await person("ZZE Admin Arjun", "zze-admin@gmail.com");
const unlisted = await person("ZZE Unlisted Uday", "zze-unlisted@gmail.com");
const outsider = await person("ZZE Outsider Om", "zze-outsider@gmail.com");
const [dept] = await sql`insert into departments (kind, name, icon) values ('application', 'ZZE ERU', 'BookOpen') returning id`;
const app = async (name, url) => (await sql`insert into apps (department_id, name, url, icon) values (${dept.id}, ${name}, ${url}, 'BookOpen') returning id`)[0];
const eruApp = await app("ZZE ERU", "/eru");
const eruAdminApp = await app("ZZE ERU Admin", "/eru/admin");
const grant = (u, a) => sql`insert into user_app_access (user_id, app_id) values (${u.id}, ${a.id}) on conflict do nothing`;
await grant(member, eruApp); await grant(admin, eruApp); await grant(admin, eruAdminApp); await grant(unlisted, eruApp);
await sql`insert into app_staff (app_id, user_id) values (${eruApp.id}, ${member.id})`;
await sql`insert into app_admins (app_id, user_id) values (${eruApp.id}, ${admin.id})`;

const browser = await launch();
const pageErrors = [];
const consoleErrors = [];
const fresh = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  ctx.setDefaultTimeout(60000);
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${new URL(page.url()).pathname}: ${String(e).slice(0, 200)}`));
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${new URL(page.url()).pathname}: ${m.text().slice(0, 300)}`));
  return { ctx, page };
};
const signedIn = async (email) => {
  const { ctx, page } = await fresh();
  await page.goto(BASE + "/login"); await page.fill("input[name=email]", email); await page.fill("input[name=password]", PW);
  await page.click("button[type=submit]"); await page.waitForURL((u) => u.pathname === "/", { timeout: 90000 });
  return { ctx, page };
};
const go = async (page, p) => { const r = await page.goto(BASE + p); await page.waitForLoadState("networkidle").catch(() => {}); return r; };
const pathOf = (page) => new URL(page.url()).pathname;
const mainText = async (page) => page.locator("main").innerText();
const navLabels = async (page, name) => (await page.locator(`nav[aria-label="${name}"] a`).allInnerTexts()).map((t) => t.trim().replace(/\s+\d+$/, "")).filter((t) => t && !/hub/i.test(t)).join("|");
const fetchIn = async (page, url) => { const r = await page.request.get(BASE + url, { maxRedirects: 0 }); return { status: r.status(), location: r.headers().location ?? null }; };
/** Selects the first occurrence of `text` in the editor (the browser selection; the editor follows it). */
const selectText = async (page, text) => {
  const found = await page.evaluate((t) => {
    const root = document.querySelector(".eru-prose");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.data.indexOf(t);
      if (i >= 0) {
        root.focus();
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        document.dispatchEvent(new Event("selectionchange"));
        return true;
      }
    }
    return false;
  }, text);
  await page.waitForTimeout(300);
  return found;
};
const caretAtEnd = async (page) => { await page.locator(".eru-prose").click(); await page.keyboard.press("ControlOrMeta+End"); await page.waitForTimeout(150); };
const saveNow = async (page) => {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  return poll(async () => /^Saved/.test((await page.getByTestId("eru-save-status").innerText()).trim()), 20000);
};
const docRow = async (id) => (await sql`select * from eru_documents where id = ${id}`)[0];

let exitCode = 0;
if (process.env.E2E_ERU_OFF === "yes") {
  try {
    section("module switched off");
    const { page } = await signedIn("zze-admin@gmail.com");
    for (const p of ["/eru", "/eru/my-projects", "/eru/domains/policy_research", "/eru/admin", "/eru/admin/projects", "/eru/admin/members", "/eru/admin/settings", "/eru/no-access"]) check(`off: ${p} is a 404`, (await go(page, p))?.status() === 404);
    for (const p of ["/api/eru/files/00000000-0000-4000-8000-000000000000", "/api/eru/documents/00000000-0000-4000-8000-000000000000/export"]) check(`off: GET ${p} is a 404`, (await fetchIn(page, p)).status === 404);
  } catch (e) { console.error(e); exitCode = 1; }
  await browser.close(); await removeTestData();
  if (exitCode) process.exit(exitCode);
  finish();
}

try {
  const Mb = await signedIn("zze-member@gmail.com");
  const Ad = await signedIn("zze-admin@gmail.com");
  const Un = await signedIn("zze-unlisted@gmail.com");
  const Ou = await signedIn("zze-outsider@gmail.com");

  section("who may open which section");
  await go(Mb.page, "/eru");
  check("a member sees the ERU Workspace with the five domain cards", /ERU Workspace/.test(await mainText(Mb.page)) && /Economic Research Unit/.test(await mainText(Mb.page)) && (await Mb.page.locator("[data-testid^=eru-domain-]").count()) === 5);
  check("the member's menu", (await navLabels(Mb.page, "ERU Workspace")) === "Domains|My projects", await navLabels(Mb.page, "ERU Workspace"));
  await go(Mb.page, "/eru/admin"); check("a member is kept out of ERU Admin", pathOf(Mb.page) === "/eru", pathOf(Mb.page));
  await go(Un.page, "/eru"); check("given ERU but on neither list: the 'not on the team' page", pathOf(Un.page) === "/eru/no-access" && /not on the ERU team/i.test(await mainText(Un.page)));
  await go(Ou.page, "/eru/admin"); check("without ERU at all: no way into ERU Admin either", pathOf(Ou.page) === "/eru/no-access");
  check("routes check who is asking (a file for someone outside the team: 403)", (await fetchIn(Ou.page, "/api/eru/files/00000000-0000-4000-8000-000000000000")).status === 403);
  await go(Ad.page, "/eru"); check("an admin's menu has ERU Admin", (await navLabels(Ad.page, "ERU Workspace")) === "Domains|My projects|ERU Admin", await navLabels(Ad.page, "ERU Workspace"));

  section("create a project");
  await Mb.page.locator("[data-testid=eru-domain-policy_research]").click();
  await Mb.page.waitForURL(/\/eru\/domains\/policy_research$/);
  check("the domain page shows its name and New Project", /Policy Research & Advocacy/.test(await mainText(Mb.page)));
  await Mb.page.getByRole("button", { name: "New Project" }).click();
  await Mb.page.fill("input[name=title]", "ZZE Pune industry outlook");
  await Mb.page.fill("textarea[name=description]", "Quarterly outlook for Pune's manufacturing sector.");
  await Mb.page.selectOption("select[name=priority]", "high");
  await Mb.page.fill("input[name=tags]", "manufacturing, quarterly");
  await Mb.page.getByRole("button", { name: "Create project" }).click();
  await Mb.page.waitForURL(/\/eru\/projects\/[0-9a-f-]{36}$/);
  const projectId = pathOf(Mb.page).split("/").pop();
  const [proj] = await sql`select * from eru_projects where id = ${projectId}`;
  check("the project is made with an ERU number, the creator assigned", /^ERU-\d{4,}$/.test(proj?.number) && proj.assigned_to.includes(member.id) && proj.priority === "high", proj);
  check("its page shows number, title, status and priority", new RegExp(`${proj.number}[\\s\\S]*ZZE Pune industry outlook[\\s\\S]*Active[\\s\\S]*High`).test(await Mb.page.locator("main header").first().innerText()));
  check("a member does not get the admin controls", (await Mb.page.getByLabel("Manage project").count()) === 0);

  section("upload a .docx");
  await Mb.page.getByTestId("eru-docx-input").setInputFiles({ name: "Pune Outlook Q2.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await sampleDocx() });
  // The editor page is the heaviest (TipTap): a dev server compiles it on first use, which can take minutes.
  await Mb.page.waitForURL(/\/eru\/documents\/[0-9a-f-]{36}$/, { timeout: Number(process.env.E2E_SLOW_MS || 90000) });
  const docId = pathOf(Mb.page).split("/").pop();
  await Mb.page.locator(".eru-prose").waitFor({ timeout: Number(process.env.E2E_SLOW_MS || 90000) });
  const prose = Mb.page.locator(".eru-prose");
  check("the editor opens with the Word file's text", /Pune Industry Outlook/.test(await prose.innerText()) && /Credit demand remains strong/.test(await prose.innerText()));
  check("its formatting came through: heading, bold, bullet", (await prose.locator("h1", { hasText: "Pune Industry Outlook" }).count()) === 1 && (await prose.locator("strong", { hasText: "rose sharply" }).count()) === 1 && (await prose.locator("ul li", { hasText: "Exports steady" }).count()) === 1);
  const d0 = await docRow(docId);
  check("the document is stored with the original upload kept", d0.title === "Pune Outlook Q2" && !!d0.original_file_id, d0);
  if (STUB) check("the original really is in the storage bucket", (await (await fetch(`${STUB}/_stub/count`)).json()).keys.some((k) => k.endsWith("Pune Outlook Q2.docx")));

  section("edit with formatting");
  await caretAtEnd(Mb.page);
  await Mb.page.keyboard.press("Enter");
  await Mb.page.keyboard.type("Outlook for Q3 is positive.");
  check("text typed into the page", /Outlook for Q3 is positive\./.test(await prose.innerText()));
  await selectText(Mb.page, "positive");
  await Mb.page.keyboard.press("ControlOrMeta+b");
  await selectText(Mb.page, "Credit demand");
  await Mb.page.getByRole("button", { name: "Italic (Ctrl+I)" }).click();
  await selectText(Mb.page, "Exports steady");
  await Mb.page.getByLabel("Text colour").fill("#dc2626");
  await selectText(Mb.page, "Outlook for Q3");
  await Mb.page.getByRole("button", { name: "Heading 2" }).click();
  await Mb.page.getByLabel("Font size (points)").selectOption("14").catch(() => {});
  check("bold, italic, colour and heading show in the page", (await prose.locator("strong", { hasText: "positive" }).count()) === 1 && (await prose.locator("em", { hasText: "Credit demand" }).count()) === 1 && (await prose.locator("span[style*='color']", { hasText: "Exports steady" }).count()) === 1 && (await prose.locator("h2", { hasText: "Outlook for Q3" }).count()) === 1, [await prose.locator("strong", { hasText: "positive" }).count(), await prose.locator("em", { hasText: "Credit demand" }).count(), await prose.locator("span[style*='color']", { hasText: "Exports steady" }).count(), await prose.locator("h2", { hasText: "Outlook for Q3" }).count(), (await prose.innerHTML()).slice(-900)]);
  check("saving shows 'Saved'", await saveNow(Mb.page));
  const d1 = await docRow(docId);
  const c1 = JSON.stringify(d1.content);
  // Stored as jsonb, which reorders keys: walk the content rather than matching its text.
  const nodes = [];
  const walk = (n, parent) => { nodes.push({ ...n, parent }); for (const c of n.content ?? []) walk(c, n); };
  walk(d1.content, null);
  const textNode = (t) => nodes.find((n) => n.type === "text" && n.text === t);
  const hasMark = (t, type, attr) => (textNode(t)?.marks ?? []).some((m) => m.type === type && (!attr || Object.entries(attr).every(([k, v]) => m.attrs?.[k] === v)));
  check("the saved content has the formatting", nodes.some((n) => n.type === "heading" && n.attrs?.level === 2) && hasMark("positive", "bold") && hasMark("Credit demand", "italic") && hasMark("Exports steady", "textStyle", { color: "#dc2626" }) && d1.version > d0.version, c1.slice(0, 400));

  section("comment");
  await selectText(Mb.page, "rose sharply");
  await Mb.page.getByTestId("eru-add-comment").click();
  await Mb.page.getByLabel("Comment", { exact: true }).fill("Which index is this from?");
  await Mb.page.getByRole("button", { name: "Comment", exact: true }).click();
  await poll(async () => (await Mb.page.getByTestId("eru-comment").count()) === 1);
  check("the comment shows in the right panel with its author", /ZZE Member Meena[\s\S]*Which index is this from\?/.test(await Mb.page.getByTestId("eru-comment").first().innerText()));
  check("the commented text is highlighted yellow", (await prose.locator(".eru-comment-open", { hasText: "rose sharply" }).count()) >= 1);
  const comments = await sql`select * from eru_document_comments where document_id = ${docId}`;
  check("the comment is stored with the quoted text", comments.length === 1 && comments[0].quote === "rose sharply" && comments[0].user_id === member.id, comments);
  await poll(async () => JSON.stringify((await docRow(docId)).content).includes(comments[0].id), 15000);
  check("its anchor is saved in the document", JSON.stringify((await docRow(docId)).content).includes(comments[0].id));

  section("track changes");
  await Mb.page.getByRole("button", { name: /Track Changes off/ }).click();
  await poll(async () => (await Mb.page.getByRole("button", { name: /Track Changes on/ }).count()) === 1);
  check("a member switches track changes on", (await docRow(docId)).track_changes === true);
  check("and cannot switch it off", await Mb.page.getByRole("button", { name: /Track Changes on/ }).isDisabled());
  await caretAtEnd(Mb.page);
  await Mb.page.keyboard.type(" Revised upward.");
  await selectText(Mb.page, "remains strong");
  await Mb.page.keyboard.press("Backspace");
  check("insertions show green, underlined; deletions red, struck through", (await prose.locator("ins.eru-ins", { hasText: "Revised upward." }).count()) === 1 && (await prose.locator("del.eru-del", { hasText: "remains strong" }).count()) === 1, [await prose.locator("ins.eru-ins").allInnerTexts(), await prose.locator("del.eru-del").allInnerTexts()]);
  check("saved", await saveNow(Mb.page));
  const pending = await sql`select * from eru_document_changes where document_id = ${docId} and status = 'pending' order by change_type`;
  check("two pending changes, both the member's", pending.length === 2 && pending.every((c) => c.user_id === member.id) && pending.some((c) => c.change_type === "deletion" && c.from_content === "remains strong") && pending.some((c) => c.change_type === "insertion" && /Revised upward\./.test(c.to_content)), pending);
  // Switching tracking on opened the Changes panel already.
  if ((await Mb.page.getByRole("button", { name: /^Changes \(2\)/ }).getAttribute("aria-pressed")) !== "true") await Mb.page.getByRole("button", { name: /^Changes \(2\)/ }).click();
  check("the member sees the changes but no Accept / Reject", (await Mb.page.getByTestId("eru-change").count()) === 2 && (await Mb.page.getByRole("button", { name: "Accept change" }).count()) === 0, [await Mb.page.getByTestId("eru-change").count(), await Mb.page.getByRole("button", { name: "Accept change" }).count()]);

  section("an admin reviews");
  await go(Ad.page, `/eru/documents/${docId}`);
  await Ad.page.locator(".eru-prose").waitFor();
  await Ad.page.getByRole("button", { name: /^Changes \(2\)/ }).click();
  const insCard = Ad.page.getByTestId("eru-change").filter({ hasText: "Revised upward." });
  await insCard.getByRole("button", { name: "Accept change" }).click();
  await poll(async () => (await Ad.page.getByTestId("eru-change").count()) === 1);
  const delCard = Ad.page.getByTestId("eru-change").filter({ hasText: "remains strong" });
  await delCard.getByRole("button", { name: "Reject change" }).click();
  await poll(async () => (await Ad.page.getByTestId("eru-change").count()) === 0);
  const reviewed = await sql`select change_type, status, reviewed_by from eru_document_changes where document_id = ${docId} order by change_type`;
  check("the insertion is accepted and the deletion rejected, by the admin", JSON.stringify(reviewed) === JSON.stringify([{ change_type: "deletion", status: "rejected", reviewed_by: admin.id }, { change_type: "insertion", status: "accepted", reviewed_by: admin.id }]), reviewed);
  const adProse = Ad.page.locator(".eru-prose");
  check("the page shows the result: the insertion plain, the deleted words back", (await adProse.locator("ins.eru-ins, del.eru-del").count()) === 0 && /Revised upward\./.test(await adProse.innerText()) && /remains strong/.test(await adProse.innerText()));
  check("the member is told", (await sql`select count(*)::int n from hub_notifications where user_id = ${member.id} and title like 'Your tracked changes were%'`)[0].n >= 1);
  await Ad.page.getByRole("button", { name: /Track Changes on/ }).click();
  await poll(async () => (await docRow(docId)).track_changes === false);
  check("the admin switches track changes off", (await docRow(docId)).track_changes === false);

  section("download");
  const [download] = await Promise.all([Ad.page.waitForEvent("download"), Ad.page.getByRole("link", { name: /Download \.docx/ }).click()]);
  const file = await download.path();
  const { readFileSync } = await import("node:fs");
  const { unzipSync, strFromU8 } = req("fflate");
  const xml = strFromU8(unzipSync(new Uint8Array(readFileSync(file)))["word/document.xml"]);
  check("the .docx download is a Word file with the reviewed text and formatting", download.suggestedFilename() === "Pune Outlook Q2.docx" && /Pune Industry Outlook/.test(xml) && /Revised upward\./.test(xml) && /remains strong/.test(xml) && /w:pStyle w:val="Heading2"/.test(xml) && /<w:b\/>/.test(xml), download.suggestedFilename());

  section("the project page");
  await go(Mb.page, `/eru/projects/${projectId}`);
  const row = Mb.page.getByTestId("eru-document-row");
  check("the document is listed with who edited it last, and an Edit and a .docx button", (await row.count()) === 1 && /Pune Outlook Q2[\s\S]*Last edited by ZZE Admin Arjun/.test(await row.innerText()) && (await row.getByRole("link", { name: "Edit" }).count()) === 1);
  check("the activity log tells the story", /imported the document[\s\S]*/.test(await mainText(Mb.page)) && /accepted 1 change/.test(await mainText(Mb.page)) && /rejected 1 change/.test(await mainText(Mb.page)));
  await Mb.page.getByRole("tab", { name: /Members/ }).click();
  check("Members: the assigned people; only an admin changes them", /ZZE Member Meena/.test(await mainText(Mb.page)) && /An ERU admin changes who is assigned/.test(await mainText(Mb.page)));

  section("ERU Admin");
  await go(Ad.page, "/eru/admin");
  check("the dashboard: four numbers, review list, chart, activity", /Total projects[\s\S]*Active[\s\S]*In review[\s\S]*Completed this month/i.test(await mainText(Ad.page)) && /Tracked changes to review/i.test(await mainText(Ad.page)) && /Projects by domain/i.test(await mainText(Ad.page)) && /Recent activity/i.test(await mainText(Ad.page)), (await mainText(Ad.page)).slice(0, 400));
  check("the admin menu", (await navLabels(Ad.page, "ERU Admin")) === "Dashboard|All Projects|Members|Settings|ERU Workspace", await navLabels(Ad.page, "ERU Admin"));
  await go(Ad.page, `/eru/admin/projects?q=${proj.number}`);
  check("All Projects: search by number finds the project, with its columns", (await Ad.page.locator("tbody tr").count()) === 1 && new RegExp(`${proj.number}[\\s\\S]*ZZE Pune industry outlook[\\s\\S]*Policy Research`).test(await Ad.page.locator("tbody").innerText()));
  await go(Ad.page, "/eru/admin/projects?status=archived&q=ZZE");
  check("All Projects: filters narrow the list", (await Ad.page.locator("tbody tr").count()) === 0);
  await go(Ad.page, `/eru/projects/${projectId}`);
  await Ad.page.getByLabel("Manage project").getByLabel("Status").selectOption("in_review");
  await poll(async () => (await sql`select status from eru_projects where id = ${projectId}`)[0].status === "in_review");
  check("an admin changes the status on the project page", (await sql`select status from eru_projects where id = ${projectId}`)[0].status === "in_review");

  await go(Ad.page, "/eru/admin/members");
  check("Members lists the team with roles", (await Ad.page.getByTestId("eru-member-row").filter({ hasText: "ZZE Member Meena" }).count()) === 1);
  await Ad.page.getByPlaceholder("At least 2 letters").fill("ZZE Outsider");
  await Ad.page.getByRole("button", { name: /Add as member/ }).click();
  await poll(async () => (await sql`select count(*)::int n from app_staff where app_id = ${eruApp.id} and user_id = ${outsider.id}`)[0].n === 1);
  check("adding someone puts them on ERU's App Staff and gives them ERU (the hub's own lists)", (await sql`select count(*)::int n from user_app_access where app_id = ${eruApp.id} and user_id = ${outsider.id}`)[0].n === 1);
  await go(Ou.page, "/eru"); check("…so they can open ERU now", pathOf(Ou.page) === "/eru" && /ERU Workspace/.test(await mainText(Ou.page)));
  await go(Ad.page, "/eru/admin/members");
  await Ad.page.getByTestId("eru-member-row").filter({ hasText: "ZZE Outsider Om" }).getByRole("button", { name: "Remove" }).click();
  await Ad.page.getByRole("button", { name: "Remove", exact: true }).last().click();
  await poll(async () => (await sql`select count(*)::int n from user_app_access where app_id = ${eruApp.id} and user_id = ${outsider.id}`)[0].n === 0);
  check("removing takes ERU away again", (await sql`select count(*)::int n from app_staff where app_id = ${eruApp.id} and user_id = ${outsider.id}`)[0].n === 0);

  await go(Ad.page, "/eru/admin/settings");
  check("Settings lists the five domains and the general settings", (await Ad.page.locator("input[name=name]").count()) >= 5 && /New documents start with track changes on/.test(await mainText(Ad.page)));
  check("Delete all data is for the Support Admin only", !/Delete all ERU data/.test(await mainText(Ad.page)));

  check("no script errors in any page", pageErrors.length === 0, pageErrors);
  check("no other ERU project was touched", (await snap()) === before);
} catch (e) {
  console.error(e);
  console.error("page errors:", pageErrors, "\nconsole errors:", consoleErrors.slice(-10));
  for (const ctx of browser.contexts()) for (const pg of ctx.pages()) console.error("open page:", pg.url(), "| toasts:", await pg.locator("[role=status], [role=alert]").allInnerTexts().catch(() => []));
  exitCode = 1;
}
await browser.close();
await removeTestData();
if (exitCode) { console.log("crashed"); process.exit(exitCode); }
finish();
