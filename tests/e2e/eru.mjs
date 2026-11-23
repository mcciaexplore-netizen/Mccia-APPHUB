/**
 * End-to-end test of the ERU module in a real browser: who may open its two sections (ERU at /eru for the team: App Staff are members, App
 * Admins are admins; ERU Admin at /eru/admin for admins), and the whole life of a document: a member creates a project, uploads a .docx
 * (converted for the editor, the original kept in storage), formats text, comments on a passage, switches track changes on and makes tracked
 * edits (and cannot switch it off); an admin accepts and rejects the changes; the .docx download carries the result. Tables (from a .docx,
 * and inserted, edited, saved and reloaded in the editor), and PDF and PowerPoint files converted for editing. Then ERU Admin: the
 * dashboard, All Projects, Members (adding someone writes the hub's own lists) and Settings. Uploading never converts a file: Word, PDF and
 * PowerPoint files are stored as they are and shown as file cards (Download, Preview, Edit in editor for Word, Convert to PDF / to Word, each
 * conversion a new card beside the original). Run against a site with ERU_ENABLED=true and
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
import { samplePdf, samplePptx, tableDocx } from "../eru-fixtures.mjs";

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
const { unzipSync, strFromU8 } = req("fflate");

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
const fresh = async (viewport = { width: 1440, height: 1000 }) => {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  ctx.setDefaultTimeout(60000);
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${new URL(page.url()).pathname}: ${String(e).slice(0, 200)}`));
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`${new URL(page.url()).pathname}: ${m.text().slice(0, 300)}`));
  return { ctx, page };
};
const signedIn = async (email, viewport) => {
  const { ctx, page } = await fresh(viewport);
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
/**
 * Puts the caret just after the first occurrence of `text` (and gives the editor a moment to follow the browser's selection). Set directly:
 * an arrow key from a selection at the end of a table cell moves on to the next cell, as tables do.
 */
const caretAfter = async (page, text) => {
  const found = await page.evaluate((t) => {
    const root = document.querySelector(".eru-prose");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.data.indexOf(t);
      if (i < 0) continue;
      root.focus();
      const r = document.createRange(); r.setStart(n, i + t.length); r.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.dispatchEvent(new Event("selectionchange"));
      return true;
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
/** Uploads a file with "Upload file" and waits for its card (nothing is converted). */
const uploadCard = async (page, name, mimeType, buffer) => {
  await page.getByTestId("eru-upload-file-input").setInputFiles({ name, mimeType, buffer });
  const card = page.locator(`[data-testid="eru-file-card"][data-file-name="${name}"]`);
  await card.waitFor({ timeout: Number(process.env.E2E_SLOW_MS || 90000) });
  return card;
};
const cardButtons = async (card) => (await card.locator("a, button").allInnerTexts()).map((t) => t.trim()).filter(Boolean).join("|");
const fileRowNamed = async (projectId, name) => (await sql`select * from eru_files where project_id = ${projectId} and file_name = ${name} order by created_at desc`)[0];
const closeDialog = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(400); };
const CODE_LOCKED = "Code blocks cannot be edited while track changes is on. Turn off track changes to edit code blocks.";
const NO_CODE_COMMENTS = "Comments cannot be added to code blocks.";
/** The editor's short message by the caret (why something was not done). */
const noticeSays = async (page, text) => poll(async () => (await page.getByTestId("eru-notice").allInnerTexts()).some((t) => t.includes(text)), 6000);

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

  section("upload a .docx: stored as it is, nothing converted");
  const docsBeforeWord = (await sql`select count(*)::int as n from eru_documents where project_id = ${projectId}`)[0].n;
  check("the button says Upload file (not Upload document)", (await Mb.page.getByRole("button", { name: "Upload file", exact: true }).count()) === 1 && (await Mb.page.getByRole("button", { name: /Upload document|Import document/ }).count()) === 0);
  const wordCard = await uploadCard(Mb.page, "Pune Outlook Q2.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", await sampleDocx());
  check("it appears as a Word file card: name, size, date, and Download, Preview, Edit in editor, Convert to PDF", /Pune Outlook Q2\.docx[\s\S]*Word · [\d.]+ (KB|B)/.test(await wordCard.innerText()) && (await cardButtons(wordCard)) === "Download|Preview|Edit in editor|Convert to PDF", [await wordCard.innerText(), await cardButtons(wordCard)]);
  check("no document was made: the upload converted nothing", (await sql`select count(*)::int as n from eru_documents where project_id = ${projectId}`)[0].n === docsBeforeWord && pathOf(Mb.page).startsWith("/eru/projects/"));
  const wordFile = await fileRowNamed(projectId, "Pune Outlook Q2.docx");
  check("stored as a project file, as uploaded", !!wordFile && wordFile.attached && !wordFile.document_id, wordFile);
  if (STUB) check("the original really is in the storage bucket", (await (await fetch(`${STUB}/_stub/count`)).json()).keys.some((k) => k.endsWith("Pune Outlook Q2.docx")));
  await wordCard.getByRole("button", { name: "Preview" }).click();
  const docxPreview = Mb.page.getByTestId("eru-preview-docx");
  await docxPreview.waitFor({ timeout: 20000 });
  check("Preview shows the Word file read only, with its formatting", /Pune Industry Outlook/.test(await docxPreview.innerText()) && (await docxPreview.locator("strong", { hasText: "rose sharply" }).count()) === 1 && (await docxPreview.locator("[contenteditable]").count()) === 0);
  await closeDialog(Mb.page);

  section("Edit in editor (Word)");
  await wordCard.getByRole("button", { name: "Edit in editor" }).click();
  check("it asks first, saying the Word file is kept", await Mb.page.getByText("This will convert your Word document to an editable document. The original Word file will be kept. Continue?").waitFor({ timeout: 8000 }).then(() => true, () => false));
  await Mb.page.getByRole("button", { name: "Continue" }).click();
  // The editor page is the heaviest (TipTap): a dev server compiles it on first use, which can take minutes.
  await Mb.page.waitForURL(/\/eru\/documents\/[0-9a-f-]{36}$/, { timeout: Number(process.env.E2E_SLOW_MS || 90000) });
  const docId = pathOf(Mb.page).split("/").pop();
  await Mb.page.locator(".eru-prose").waitFor({ timeout: Number(process.env.E2E_SLOW_MS || 90000) });
  const prose = Mb.page.locator(".eru-prose");
  check("the editor opens with the Word file's text", /Pune Industry Outlook/.test(await prose.innerText()) && /Credit demand remains strong/.test(await prose.innerText()));
  check("its formatting came through: heading, bold, bullet", (await prose.locator("h1", { hasText: "Pune Industry Outlook" }).count()) === 1 && (await prose.locator("strong", { hasText: "rose sharply" }).count()) === 1 && (await prose.locator("ul li", { hasText: "Exports steady" }).count()) === 1);
  const d0 = await docRow(docId);
  check("the document points at the Word file as its original", d0.title === "Pune Outlook Q2" && d0.original_file_id === wordFile.id, d0);
  const wordAfter = await fileRowNamed(projectId, "Pune Outlook Q2.docx");
  check("the Word file is still a project file of its own (side by side, not owned by the document)", !!wordAfter && !wordAfter.document_id);

  section("edit with formatting");
  await caretAtEnd(Mb.page);
  await Mb.page.keyboard.press("Enter");
  // A code block, made while tracking is still off (it is locked once tracking is on), then out of it with Enter three times.
  await Mb.page.getByRole("button", { name: "Code block" }).click();
  await Mb.page.keyboard.type("x = 1");
  for (let i = 0; i < 3; i++) await Mb.page.keyboard.press("Enter");
  check("a code block can be made and written in while tracking is off", (await prose.locator("pre", { hasText: "x = 1" }).count()) === 1, await prose.innerHTML());
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
  check("the saved content has the formatting", nodes.some((n) => n.type === "heading" && n.attrs?.level === 2) && hasMark("positive", "bold") && hasMark("Credit demand", "italic") && hasMark("Exports steady", "textStyle", { color: "#dc2626" }) && nodes.some((n) => n.type === "codeBlock" && (n.content ?? []).some((t) => t.text === "x = 1")) && d1.version > d0.version, c1.slice(0, 400));

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

  check("the ERU admin is told about the comment (not assigned to the project, but an admin)", (await sql`select count(*)::int n from hub_notifications where user_id = ${admin.id} and kind = 'eru' and title like 'New comment on%'`)[0].n === 1);
  check("…and the commenter is not", (await sql`select count(*)::int n from hub_notifications where user_id = ${member.id} and title like 'New comment on%'`)[0].n === 0);

  section("comments on a narrow screen (a drawer from the bottom)");
  {
    const Nw = await signedIn("zze-member@gmail.com", { width: 900, height: 900 });
    await go(Nw.page, `/eru/documents/${docId}`);
    await Nw.page.locator(".eru-prose").waitFor();
    check("on a narrow screen the comments do not pop up by themselves", (await Nw.page.getByTestId("eru-drawer").count()) === 0 && (await Nw.page.locator("aside[aria-label=Comments]").count()) === 0);
    await Nw.page.getByRole("button", { name: /^Comments \(1\)/ }).click();
    const drawer = Nw.page.getByTestId("eru-drawer");
    await poll(async () => (await drawer.getAttribute("data-open").catch(() => null)) === "true");
    await Nw.page.waitForTimeout(400);
    const box = await drawer.boundingBox();
    check("\"Comments\" opens a drawer that slides up from the bottom, with the comment in it", (await drawer.getAttribute("role")) === "dialog" && /Which index is this from\?/.test(await drawer.innerText()) && !!box && Math.abs(box.y + box.height - 900) < 2 && box.height < 900, box);
    check("the comments are not also shown beside the page", (await Nw.page.locator("aside[aria-label=Comments]").count()) === 0);
    await Nw.page.keyboard.press("Escape");
    await poll(async () => (await drawer.count()) === 0);
    check("Escape slides it away", (await drawer.count()) === 0);
    await Nw.page.getByRole("button", { name: /^Comments \(1\)/ }).click();
    await poll(async () => (await drawer.getAttribute("data-open").catch(() => null)) === "true");
    await Nw.page.locator(".eru-drawer-backdrop").click({ position: { x: 20, y: 20 } });
    await poll(async () => (await drawer.count()) === 0);
    check("so does a tap on the page behind it", (await drawer.count()) === 0);
    await Nw.ctx.close();
  }

  section("track changes");
  await Mb.page.getByRole("button", { name: /Track Changes off/ }).click();
  await poll(async () => (await Mb.page.getByRole("button", { name: /Track Changes on/ }).count()) === 1);
  check("a member switches track changes on", (await docRow(docId)).track_changes === true);
  check("and cannot switch it off", await Mb.page.getByRole("button", { name: /Track Changes on/ }).isDisabled());
  await caretAtEnd(Mb.page);
  await Mb.page.keyboard.type(" Revised upward.");
  await selectText(Mb.page, "remains strong");
  await Mb.page.keyboard.press("Backspace");
  // Backspace again, right after the deleted words: the caret steps over them (the browser is never left to delete inside struck-through text).
  await Mb.page.keyboard.press("Backspace");
  check("Backspace next to deleted text steps over it, making no new change", (await prose.locator("del.eru-del").allInnerTexts()).join("|") === "remains strong" && (await prose.locator("ins.eru-ins").allInnerTexts()).join("|") === " Revised upward.", [await prose.locator("del.eru-del").allInnerTexts(), await prose.locator("ins.eru-ins").allInnerTexts()]);
  check("insertions show green, underlined; deletions red, struck through", (await prose.locator("ins.eru-ins", { hasText: "Revised upward." }).count()) === 1 && (await prose.locator("del.eru-del", { hasText: "remains strong" }).count()) === 1, [await prose.locator("ins.eru-ins").allInnerTexts(), await prose.locator("del.eru-del").allInnerTexts()]);
  check("saved", await saveNow(Mb.page));
  const pending = await sql`select * from eru_document_changes where document_id = ${docId} and status = 'pending' order by change_type`;
  check("two pending changes, both the member's", pending.length === 2 && pending.every((c) => c.user_id === member.id) && pending.some((c) => c.change_type === "deletion" && c.from_content === "remains strong") && pending.some((c) => c.change_type === "insertion" && /Revised upward\./.test(c.to_content)), pending);
  // Switching tracking on opened the Changes panel already.
  if ((await Mb.page.getByRole("button", { name: /^Changes \(2\)/ }).getAttribute("aria-pressed")) !== "true") await Mb.page.getByRole("button", { name: /^Changes \(2\)/ }).click();
  check("the member sees the changes but no Accept / Reject", (await Mb.page.getByTestId("eru-change").count()) === 2 && (await Mb.page.getByRole("button", { name: "Accept change" }).count()) === 0, [await Mb.page.getByTestId("eru-change").count(), await Mb.page.getByRole("button", { name: "Accept change" }).count()]);

  section("code blocks while track changes is on");
  const pre = prose.locator("pre", { hasText: "x = 1" });
  check("the code block shows as locked, with the reason as its tooltip", /eru-code-locked/.test((await pre.getAttribute("class")) ?? "") && (await pre.getAttribute("title")) === CODE_LOCKED);
  await pre.click();
  await Mb.page.keyboard.press("End");
  await Mb.page.keyboard.type("9");
  check("typing in it changes nothing, and says why", (await pre.innerText()).trim() === "x = 1" && (await noticeSays(Mb.page, CODE_LOCKED)), await pre.innerText());
  await Mb.page.keyboard.press("Backspace");
  check("nor does Backspace", (await pre.innerText()).trim() === "x = 1");
  // A switched-off (aria-disabled) button still answers a person's click with its reason. Playwright will not click one, so the click is
  // sent to the button itself (also sure to reach it, whatever the sticky toolbar covers).
  await Mb.page.getByRole("button", { name: /^Code block/ }).dispatchEvent("click");
  check("the toolbar's Code block button is locked too, and says why", (await Mb.page.getByRole("button", { name: /^Code block/ }).getAttribute("aria-disabled")) === "true" && (await noticeSays(Mb.page, CODE_LOCKED)));

  section("no comments on code blocks");
  await selectText(Mb.page, "x = 1");
  const addOnCode = Mb.page.getByTestId("eru-add-comment");
  check("\"Add comment\" is switched off for a code-block selection", (await addOnCode.getAttribute("aria-disabled")) === "true" && (await addOnCode.getAttribute("title")) === NO_CODE_COMMENTS);
  await addOnCode.dispatchEvent("click");
  check("clicking it says comments cannot be added to code blocks, and adds none", (await noticeSays(Mb.page, NO_CODE_COMMENTS)) && (await Mb.page.getByLabel("Comment", { exact: true }).count()) === 0 && (await sql`select count(*)::int n from eru_document_comments where document_id = ${docId}`)[0].n === 1, [await Mb.page.getByTestId("eru-notice").allInnerTexts(), await Mb.page.getByLabel("Comment", { exact: true }).count(), (await sql`select count(*)::int n from eru_document_comments where document_id = ${docId}`)[0].n]);
  check("the toolbar's comment button is switched off there too", (await Mb.page.getByRole("button", { name: /^Add a comment on the selected text/ }).getAttribute("aria-disabled")) === "true");
  check("saved: still exactly the two tracked changes, the code block as it was", (await saveNow(Mb.page)) && (await sql`select count(*)::int n from eru_document_changes where document_id = ${docId} and status = 'pending'`)[0].n === 2 && JSON.stringify((await docRow(docId)).content).includes('"x = 1"'), [await sql`select change_type, from_content, to_content from eru_document_changes where document_id = ${docId} and status = 'pending'`, await prose.locator("pre").innerText()]);

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
  const xml = strFromU8(unzipSync(new Uint8Array(readFileSync(file)))["word/document.xml"]);
  check("the .docx download is a Word file with the reviewed text and formatting", download.suggestedFilename() === "Pune Outlook Q2.docx" && /Pune Industry Outlook/.test(xml) && /Revised upward\./.test(xml) && /remains strong/.test(xml) && /w:pStyle w:val="Heading2"/.test(xml) && /<w:b\/>/.test(xml), download.suggestedFilename());

  section("the project page");
  await go(Mb.page, `/eru/projects/${projectId}`);
  const row = Mb.page.getByTestId("eru-document-row");
  check("the document is listed with who edited it last, and an Edit and a .docx button", (await row.count()) === 1 && /Pune Outlook Q2[\s\S]*Last edited by ZZE Admin Arjun/.test(await row.innerText()) && (await row.getByRole("link", { name: "Edit" }).count()) === 1);
  check("the activity log tells the story", /made the editable document "Pune Outlook Q2" from Pune Outlook Q2\.docx/.test(await mainText(Mb.page)) && /accepted 1 change/.test(await mainText(Mb.page)) && /rejected 1 change/.test(await mainText(Mb.page)));
  const wordCard2 = Mb.page.locator('[data-testid="eru-file-card"][data-file-name="Pune Outlook Q2.docx"]');
  check("the original Word file is still listed, beside the document", (await wordCard2.count()) === 1);
  await wordCard2.getByRole("button", { name: "Convert to PDF" }).click();
  const wordPdf = Mb.page.locator('[data-testid="eru-file-card"][data-file-name="Pune Outlook Q2.pdf"]');
  check("Convert to PDF saves a new PDF file card; the Word file stays", await wordPdf.waitFor({ timeout: 60000 }).then(() => true, () => false) && (await wordCard2.count()) === 1);
  const wordPdfRow = await fileRowNamed(projectId, "Pune Outlook Q2.pdf");
  const wordPdfBytes = Buffer.from(await (await Mb.page.request.get(`${BASE}/api/eru/files/${wordPdfRow.id}`)).body());
  check("…and it is a real PDF", wordPdfBytes.subarray(0, 5).toString() === "%PDF-" && wordPdfBytes.length > 800 && wordPdfRow.mime === "application/pdf", wordPdfBytes.length);
  check("the PDF card offers Preview and Convert to Word", (await cardButtons(wordPdf)) === "Download|Preview|Convert to Word", await cardButtons(wordPdf));
  await Mb.page.getByRole("tab", { name: /Members/ }).click();
  check("Members tab: a member sees it and the assigned people", (await Mb.page.getByRole("tab", { name: /Members/ }).count()) === 1 && /ZZE Member Meena/.test(await mainText(Mb.page)));
  check("…but cannot add or remove anyone", (await Mb.page.getByRole("button", { name: /Remove|Assign/ }).count()) === 0 && /An ERU admin changes who is assigned/.test(await mainText(Mb.page)));

  const SLOW = Number(process.env.E2E_SLOW_MS || 90000);
  const ed = Mb.page.locator(".eru-prose");
  const tool = (name) => Mb.page.getByRole("button", { name, exact: true });
  const shape = async () => ({ rows: await ed.locator("table tr").count(), cols: await ed.locator("table tr").first().locator("th, td").count(), th: await ed.locator("table th").count() });
  /** The stored document's tables, as rows of cell texts (walking the jsonb, whose key order is not kept). */
  const storedTables = async (id) => {
    const out = [];
    const txt = (n) => (n.text ?? "") + (n.content ?? []).map(txt).join("");
    const walk = (n) => (n.type === "table" ? out.push(n.content.map((r) => r.content.map(txt))) : (n.content ?? []).forEach(walk));
    walk((await docRow(id)).content);
    return out;
  };
  const docxXml = async (id) => {
    const r = await Mb.page.request.get(`${BASE}/api/eru/documents/${id}/export`);
    return strFromU8(unzipSync(new Uint8Array(await r.body()))["word/document.xml"]);
  };

  section("tables: a .docx with a table");
  await go(Mb.page, `/eru/projects/${projectId}`);
  check("Upload file takes any file (no type filter)", (await Mb.page.getByTestId("eru-upload-file-input").getAttribute("accept")) === null);
  const tableCard = await uploadCard(Mb.page, "Cluster Comparison.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", await tableDocx());
  await tableCard.getByRole("button", { name: "Edit in editor" }).click();
  await Mb.page.getByRole("button", { name: "Continue" }).click();
  await Mb.page.waitForURL(/\/eru\/documents\/[0-9a-f-]{36}$/, { timeout: SLOW });
  const wordTableId = pathOf(Mb.page).split("/").pop();
  await ed.waitFor({ timeout: SLOW });
  const t0 = await shape();
  check("the Word file's table appears as a table in the editor (3 rows of 3, its header row as header cells, the text in its cells)", t0.rows === 3 && t0.cols === 3 && t0.th === 3 && (await ed.locator("table td, table th").filter({ hasText: "Hinjewadi" }).count()) === 1 && (await ed.locator("h1", { hasText: "Cluster Comparison" }).count()) === 1, [t0, (await ed.innerHTML()).slice(0, 600)]);
  check("a Word file gets no conversion note", (await Mb.page.getByTestId("eru-converted-note").count()) === 0);
  await caretAfter(Mb.page, "Chakan");
  await Mb.page.keyboard.type(" (Pune)");
  await tool("Add row below").click();
  await ed.locator("table tr").nth(2).locator("td").first().click();
  await Mb.page.keyboard.type("Talegaon");
  check("its cells can be edited and a row added", (await shape()).rows === 4 && /Chakan \(Pune\)/.test(await ed.innerText()));
  check("saved", await saveNow(Mb.page));
  await Mb.page.reload();
  await ed.waitFor({ timeout: SLOW });
  check("reloaded, the table is still there with the edits", (await shape()).rows === 4 && /Talegaon/.test(await ed.locator("table").innerText()) && /Chakan \(Pune\)/.test(await ed.locator("table").innerText()), await shape());
  const wordTables = await storedTables(wordTableId);
  check("stored as a table: four rows, the new one in its place", wordTables.length === 1 && wordTables[0].length === 4 && wordTables[0][1][0] === "Chakan (Pune)" && wordTables[0][2][0] === "Talegaon", wordTables);

  section("tables: inserted in the editor");
  await go(Mb.page, `/eru/projects/${projectId}`);
  await Mb.page.getByRole("button", { name: "New document" }).click();
  await Mb.page.fill("input[name=title]", "ZZE Jobs table");
  await Mb.page.getByRole("button", { name: "Create and open" }).click();
  await Mb.page.waitForURL(/\/eru\/documents\/[0-9a-f-]{36}$/, { timeout: SLOW });
  const tableDocId = pathOf(Mb.page).split("/").pop();
  await ed.waitFor({ timeout: SLOW });
  await ed.click();
  await Mb.page.keyboard.type("Jobs by year");
  check("the row, column and delete-table buttons wait until the caret is in a table", (await tool("Add row below").isDisabled()) && (await tool("Delete column").isDisabled()) && (await tool("Delete table").isDisabled()) && !(await tool("Insert table").isDisabled()));
  await tool("Insert table").click();
  check("Insert table puts in a 3×3 table with a header row", JSON.stringify(await shape()) === JSON.stringify({ rows: 3, cols: 3, th: 3 }), await shape());
  for (const [i, t] of ["Year", "Units", "Jobs", "2025", "310", "88000"].entries()) {
    if (i) await Mb.page.keyboard.press("Tab");
    await Mb.page.keyboard.type(t);
  }
  await tool("Add row below").click();
  await tool("Add column to the right").click();
  check("Add row below and Add column to the right", JSON.stringify(await shape()) === JSON.stringify({ rows: 4, cols: 4, th: 4 }), await shape());
  await ed.locator("table tr").first().locator("th").nth(3).click();
  await tool("Delete column").click();
  await ed.locator("table tr").nth(2).locator("td").first().click();
  await tool("Delete row").click();
  check("Delete column and Delete row take out the ones the caret is in", JSON.stringify(await shape()) === JSON.stringify({ rows: 3, cols: 3, th: 3 }) && /88000/.test(await ed.locator("table").innerText()), await shape());
  check("saved", await saveNow(Mb.page));
  await Mb.page.reload();
  await ed.waitFor({ timeout: SLOW });
  const reloaded = await ed.locator("table tr").allInnerTexts();
  check("reloaded, the table is back exactly: header row and cells with their text", JSON.stringify(await shape()) === JSON.stringify({ rows: 3, cols: 3, th: 3 }) && /Year\s+Units\s+Jobs/.test(reloaded[0]) && /2025\s+310\s+88000/.test(reloaded[1]), reloaded);
  check("stored as a table in the database", JSON.stringify(await storedTables(tableDocId)) === JSON.stringify([[["Year", "Units", "Jobs"], ["2025", "310", "88000"], ["", "", ""]]]), await storedTables(tableDocId));
  const tableXml = await docxXml(tableDocId);
  check("the .docx download has the table (header row repeated on each page)", /<w:tbl>/.test(tableXml) && /88000/.test(tableXml) && /<w:tblHeader\/>/.test(tableXml));
  await ed.locator("table td").first().click();
  await tool("Delete table").click();
  const gone = (await ed.locator("table").count()) === 0;
  await Mb.page.keyboard.press("ControlOrMeta+z");
  check("Delete table removes it; undo brings it back", gone && (await ed.locator("table").count()) === 1);

  section("a PDF: stored as it is; Preview and Convert to Word");
  await go(Mb.page, `/eru/projects/${projectId}`);
  const docsBeforePdf = (await sql`select count(*)::int as n from eru_documents where project_id = ${projectId}`)[0].n;
  const pdfCard = await uploadCard(Mb.page, "Pune Manufacturing Survey.pdf", "application/pdf", samplePdf());
  check("a PDF card: Download, Preview, Convert to Word (no Edit in editor)", (await cardButtons(pdfCard)) === "Download|Preview|Convert to Word", await cardButtons(pdfCard));
  check("no document was made", (await sql`select count(*)::int as n from eru_documents where project_id = ${projectId}`)[0].n === docsBeforePdf);
  if (STUB) check("the PDF really is in the storage bucket", (await (await fetch(`${STUB}/_stub/count`)).json()).keys.some((k) => k.endsWith("Pune Manufacturing Survey.pdf")));
  await pdfCard.getByRole("button", { name: "Preview" }).click();
  const pdfCanvas = Mb.page.getByTestId("eru-preview-pdf");
  await pdfCanvas.waitFor({ timeout: 20000 });
  await poll(async () => (await pdfCanvas.evaluate((c) => c.width)) > 100, 15000);
  check("Preview draws the PDF's pages in the page", /Page 1 of \d+/.test(await Mb.page.getByTestId("eru-preview-page").innerText()) && (await pdfCanvas.evaluate((c) => c.width)) > 100);
  await closeDialog(Mb.page);
  await pdfCard.getByRole("button", { name: "Convert to Word" }).click();
  const pdfWord = Mb.page.locator('[data-testid="eru-file-card"][data-file-name="Pune Manufacturing Survey.docx"]');
  check("Convert to Word saves a new Word file card; the PDF stays", await pdfWord.waitFor({ timeout: 60000 }).then(() => true, () => false) && (await pdfCard.count()) === 1);
  const pdfWordRow = await fileRowNamed(projectId, "Pune Manufacturing Survey.docx");
  const pdfWordXml = strFromU8(unzipSync(new Uint8Array(await (await Mb.page.request.get(`${BASE}/api/eru/files/${pdfWordRow.id}`)).body()))["word/document.xml"]);
  check("…a Word file with the PDF's text and headings", /Key findings/.test(pdfWordXml) && /Outlook/.test(pdfWordXml) && /led by automotive components/.test(pdfWordXml) && /w:pStyle w:val="Heading2"/.test(pdfWordXml));
  check("…which can itself be edited in the editor", (await cardButtons(pdfWord)) === "Download|Preview|Edit in editor|Convert to PDF", await cardButtons(pdfWord));

  section("a PowerPoint: Preview a slide at a time, Convert to PDF");
  const pptxCard = await uploadCard(Mb.page, "Quarterly Review.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", await samplePptx());
  check("a PowerPoint card: Download, Preview, Convert to PDF", (await cardButtons(pptxCard)) === "Download|Preview|Convert to PDF", await cardButtons(pptxCard));
  await pptxCard.getByRole("button", { name: "Preview" }).click();
  const slide = Mb.page.getByTestId("eru-preview-slide");
  await slide.waitFor({ timeout: 20000 });
  check("Preview shows slide 1 of 2 with its title and bullets", (await Mb.page.getByTestId("eru-preview-page").innerText()) === "Slide 1 of 2" && /Quarterly Highlights/.test(await slide.innerText()) && /18 percent/.test(await slide.innerText()));
  await Mb.page.getByRole("button", { name: "Next slide" }).click();
  check("…and the next slide (its table)", (await Mb.page.getByTestId("eru-preview-page").innerText()) === "Slide 2 of 2" && /Sector Table/.test(await slide.innerText()) && (await slide.locator("table td", { hasText: "Sector" }).count()) >= 1);
  await closeDialog(Mb.page);
  await pptxCard.getByRole("button", { name: "Convert to PDF" }).click();
  const pptxPdf = Mb.page.locator('[data-testid="eru-file-card"][data-file-name="Quarterly Review.pdf"]');
  check("Convert to PDF saves a new PDF card; the PowerPoint stays", await pptxPdf.waitFor({ timeout: 60000 }).then(() => true, () => false) && (await pptxCard.count()) === 1);
  const pptxPdfBytes = Buffer.from(await (await Mb.page.request.get(`${BASE}/api/eru/files/${(await fileRowNamed(projectId, "Quarterly Review.pdf")).id}`)).body()).toString("latin1");
  check("…a PDF with one page per slide", pptxPdfBytes.startsWith("%PDF-") && (pptxPdfBytes.match(/\/Type \/Page\b/g) ?? []).length === 2, (pptxPdfBytes.match(/\/Type \/Page\b/g) ?? []).length);

  section("any other file: Download only");
  const docsBeforeTxt = (await sql`select count(*)::int as n from eru_documents where project_id = ${projectId}`)[0].n;
  const txtCard = await uploadCard(Mb.page, "notes.txt", "text/plain", Buffer.from("plain notes"));
  check("a .txt file is stored and offers only Download", (await cardButtons(txtCard)) === "Download" && (await sql`select count(*)::int as n from eru_documents where project_id = ${projectId}`)[0].n === docsBeforeTxt, await cardButtons(txtCard));

  section("ERU Admin");
  await go(Ad.page, "/eru/admin");
  check("the dashboard: four numbers, review list, chart, activity", /Total projects[\s\S]*Active[\s\S]*In review[\s\S]*Completed this month/i.test(await mainText(Ad.page)) && /Tracked changes to review/i.test(await mainText(Ad.page)) && /Projects by domain/i.test(await mainText(Ad.page)) && /Recent activity/i.test(await mainText(Ad.page)), (await mainText(Ad.page)).slice(0, 400));
  check("the admin menu", (await navLabels(Ad.page, "ERU Admin")) === "Dashboard|All Projects|Members|Settings|ERU Workspace", await navLabels(Ad.page, "ERU Admin"));
  await go(Ad.page, `/eru/admin/projects?q=${proj.number}`);
  check("All Projects: search by number finds the project, with its columns", (await Ad.page.locator("tbody tr").count()) === 1 && new RegExp(`${proj.number}[\\s\\S]*ZZE Pune industry outlook[\\s\\S]*Policy Research`).test(await Ad.page.locator("tbody").innerText()));
  await go(Ad.page, "/eru/admin/projects?status=archived&q=ZZE");
  check("All Projects: filters narrow the list", (await Ad.page.locator("tbody tr").count()) === 0);
  await go(Ad.page, `/eru/projects/${projectId}`);
  await Ad.page.getByRole("tab", { name: /Members/ }).click();
  check("Members tab: an admin can assign and remove", (await Ad.page.getByRole("button", { name: "Assign" }).count()) === 1 && (await Ad.page.getByRole("button", { name: "Remove" }).count()) >= 1);
  await Ad.page.getByLabel("Manage project").getByLabel("Status").selectOption("completed");
  await poll(async () => (await sql`select status from eru_projects where id = ${projectId}`)[0].status === "completed");
  check("an admin changes the status on the project page", (await sql`select status from eru_projects where id = ${projectId}`)[0].status === "completed");
  await go(Ad.page, "/eru/admin");
  const doneCard = Ad.page.getByRole("link", { name: /Completed this month/i });
  check("the dashboard's \"Completed this month\" counts it and links to this month's completed projects", Number((await doneCard.innerText()).replace(/\D+/g, "")) >= 1 && (await doneCard.getAttribute("href")) === "/eru/admin/projects?completed=month", [await doneCard.innerText(), await doneCard.getAttribute("href")]);
  await doneCard.click();
  await Ad.page.waitForURL(/completed=month/);
  check("…and the list it opens shows the project, filtered to completed this month", new RegExp(proj.number).test(await Ad.page.locator("tbody").innerText()) && /completed this month/i.test(await mainText(Ad.page)) && (await Ad.page.getByLabel("Completed this month").isChecked()));

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
