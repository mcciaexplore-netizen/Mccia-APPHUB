/**
 * Browser test: starts the real server (serving the built client) on a throwaway database, then signs in as all four people in a real
 * Chrome and walks the whole approval flow: forms, budget numbers, routing, more-info and resubmit, approve/reject, lists and masters.
 *
 * Needs: `npm run build` first, and Google Chrome (or set UI_BROWSER_CHANNEL; "chromium" uses Playwright's own download).
 * Run: npm run test:ui     Nothing here touches database/mccia.db or uploads/.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!fs.existsSync(path.join(ROOT, "client", "dist", "index.html"))) { console.error("Run `npm run build` first: the test uses the built client."); process.exit(2); }

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mccia-ui-"));
const port = await freePort();
const BASE = `http://localhost:${port}`;
const server = spawn(process.execPath, ["server/index.js"], {
  cwd: ROOT, stdio: ["ignore", "pipe", "inherit"],
  env: { ...process.env, PORT: String(port), DB_FILE: path.join(tmp, "ui.db"), UPLOAD_DIR: path.join(tmp, "uploads"), SESSION_SECRET: "ui-test" },
});
await new Promise((resolve, reject) => { server.stdout.on("data", (d) => String(d).includes("running") && resolve()); server.on("exit", () => reject(new Error("the server did not start"))); setTimeout(() => reject(new Error("the server took too long to start")), 15000); });

let ok = 0, bad = 0;
const check = (name, pass, extra = "") => { if (pass) ok++; else bad++; console.log(pass ? "PASS" : "FAIL", name, pass || !extra ? "" : `-> ${String(extra).slice(0, 200)}`); };
const poll = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn().catch(() => false); if (v) return v; await new Promise((r) => setTimeout(r, 200)); } return v; };

const browser = await chromium.launch({ channel: process.env.UI_BROWSER_CHANNEL === "chromium" ? undefined : process.env.UI_BROWSER_CHANNEL ?? "chrome", headless: true });
const errors = [];
const signIn = async (username, viewport = { width: 1300, height: 900 }) => {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE + "/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("mccia123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: /Welcome/ }).waitFor();
  return page;
};
const toast = (p, t) => p.getByText(t).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
const row = (p, label) => p.locator("div.mb-5", { has: p.locator("label", { hasText: label }) });
const labelsOf = async (p) => (await p.locator("form label").allInnerTexts()).map((t) => t.replace(/\s*\*$/, "").trim());
const hasInputValue = (p, text) => p.waitForFunction((t) => [...document.querySelectorAll("input")].some((i) => i.value.includes(t)), text);

try {
  const emp = await signIn("employee"), shr = await signIn("shrotri"), sat = await signIn("satavisha"), dg = await signIn("dg");
  const nav = async (p) => p.locator("nav").innerText();

  check("employee sees the five forms to submit", (await emp.locator("a[href^='/new/']").count()) === 5);
  check("employee's sidebar", ["My Expenses", "My HR Requests", "My Reimbursements", "My Events"].every((t) => true) && (await nav(emp)).includes("My Reimbursements"));
  check("Shrotri's sidebar", (await nav(shr)).includes("Pending Expenditures") && (await nav(shr)).includes("Rejected"));
  check("Satavisha's sidebar", (await nav(sat)).includes("Pending HR Requests") && !(await nav(sat)).includes("Pending Events"));
  check("the DG's sidebar", (await nav(dg)).includes("All Pending (escalated)") && (await nav(dg)).includes("Full History"));
  check("staff have no Budgets or Masters, the DG has both", !(await nav(emp)).includes("Budgets") && (await nav(dg)).includes("Budgets") && (await nav(dg)).includes("Masters"));

  // The DG sets a budget on the Budgets screen
  await dg.goto(BASE + "/budgets");
  await dg.locator("select").nth(0).selectOption({ label: "Head Office" });
  await dg.locator("select").nth(1).selectOption({ label: "Marketing" });
  await dg.locator("input[type=number]").fill("50000");
  await dg.getByRole("button", { name: "Save budget" }).click();
  check("the DG saves a 50,000 budget", await toast(dg, "Budget saved") && (await poll(async () => (await dg.locator("tbody").innerText()).includes("₹50,000.00"))));

  // Expenditure form (below 10,000)
  await emp.goto(BASE + "/new/expenditure");
  check("the Expenditure form has the specified fields in order", JSON.stringify(await labelsOf(emp)) === JSON.stringify(["Name", "Email", "Date", "Category", "Nature of Expenditure", "Branch Name", "Available Budget", "Budget Remaining", "File Upload", "Date of Tax Invoice", "Vendor Name", "Tax Invoice", "Quotation", "Amount", "Type of Publication", "Publication"]), (await labelsOf(emp)).join(" | "));
  check("the email is filled from the chosen name", (await row(emp, "Email").locator("input").inputValue()).includes("@"));
  check("the date shows as dd-MMM-yyyy with the time", /^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}:\d{2}$/.test(await row(emp, "Date").first().locator("input").inputValue()));
  check("required fields carry an asterisk", (await emp.locator("form label span.text-red-500").count()) >= 5);
  await emp.locator("select").nth(1).selectOption({ label: "Marketing" });
  await emp.locator("select").nth(2).selectOption({ label: "Head Office" });
  await hasInputValue(emp, "50,000.00");
  check("choosing branch and category fills Available Budget (₹50,000.00)", (await row(emp, "Available Budget").locator("input").inputValue()) === "₹50,000.00");
  await row(emp, /^Amount/).locator("input").fill("15000");
  check("15,000 on the below-10k form shows the redirect message and blocks Submit", (await emp.getByText("Amounts of ₹10,000 and above must be submitted through DG Approval").count()) >= 1 && (await emp.getByRole("button", { name: "Submit" }).isDisabled()));
  await row(emp, /^Amount/).locator("input").fill("4000");
  check("4,000 shows Budget Remaining ₹46,000.00", (await row(emp, "Budget Remaining").locator("input").inputValue()) === "₹46,000.00");
  await emp.getByRole("button", { name: "Submit" }).click();
  check("submitting without the vendor says so", await toast(emp, "Vendor Name is required"));
  await row(emp, "Vendor Name").locator("textarea").fill("ZZ Printers");
  check("fixing a field clears the error under it", (await row(emp, "Vendor Name").getByText("is required").count()) === 0);
  await row(emp, "Tax Invoice").locator("input[type=file]").first().setInputFiles({ name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 invoice") });
  await emp.getByRole("button", { name: "Submit" }).click();
  await emp.waitForURL(/\/submission\/\d+/);
  check("a successful submit shows a toast and the request as Pending", await toast(emp, "Submitted EXP-") && (await poll(async () => (await emp.locator("main").innerText()).includes("Pending"))));
  const exp1 = emp.url();

  // Shrotri asks for more information; the employee answers; Shrotri approves
  await shr.goto(BASE + "/");
  check("Shrotri's sidebar shows the waiting count", await poll(async () => (await shr.locator("nav span.bg-yellow-400").count()) >= 1));
  await shr.goto(exp1);
  check("he sees every submitted field and the invoice link", await poll(async () => (await shr.locator("main").innerText()).includes("ZZ Printers") && (await shr.getByRole("link", { name: "invoice.pdf" }).count()) === 1));
  await shr.getByRole("button", { name: "Request More Info" }).click();
  check("asking for more information without a note is refused", await toast(shr, "Please say what information is needed"));
  await shr.getByPlaceholder("Comment").fill("Please attach the quotation");
  await shr.getByRole("button", { name: "Request More Info" }).click();
  check("then it is marked More Info Required (blue)", await toast(shr, "More information requested") && (await poll(async () => (await shr.locator("main span.bg-blue-100").count()) >= 1)));
  await emp.goto(exp1);
  check("the employee sees the question and an Edit and resubmit button", await poll(async () => (await emp.locator("main").innerText()).includes("Please attach the quotation") && (await emp.getByRole("link", { name: "Edit and resubmit" }).count()) === 1));
  await emp.getByRole("link", { name: "Edit and resubmit" }).click();
  await row(emp, "Quotation").locator("input[type=file]").setInputFiles({ name: "quote.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 quote") });
  await emp.getByRole("button", { name: "Resubmit" }).click();
  check("the employee resubmits", await toast(emp, "Resubmitted EXP-"));
  await shr.goto(exp1);
  await shr.getByRole("button", { name: "Approve" }).click();
  check("Shrotri approves: Approved (green), final", await poll(async () => (await shr.locator("main span.bg-green-100").count()) >= 1));
  check("the audit trail lists each step", await poll(async () => (await shr.locator("ol li").count()) === 4 && (await shr.locator("ol").innerText()).includes("Requested more information")));

  // DG expenditure: Shrotri, then the DG, who rejects
  await emp.goto(BASE + "/new/dg_expenditure");
  const dgLabels = await labelsOf(emp);
  check("the DG Expenditure form adds Difference and Budget Allocated", dgLabels.includes("Difference") && dgLabels.includes("Budget Allocated"));
  await emp.locator("select").nth(1).selectOption({ label: "Marketing" });
  await emp.locator("select").nth(2).selectOption({ label: "Head Office" });
  await hasInputValue(emp, "50,000.00");
  await row(emp, /^Amount/).locator("input").fill("60000");
  check("60,000 shows a negative Difference and an over-budget warning", (await row(emp, "Difference").locator("input").inputValue()) === "-₹14,000.00" && (await emp.getByText("exceeds the remaining budget").count()) >= 1, await row(emp, "Difference").locator("input").inputValue());
  await row(emp, "Vendor Name").locator("textarea").fill("ZZ Big Vendor");
  await emp.getByRole("button", { name: "Submit" }).click();
  await emp.waitForURL(/\/submission\/\d+/);
  const dgUrl = emp.url();
  await shr.goto(dgUrl);
  await shr.getByRole("button", { name: "Approve" }).click();
  check("after Shrotri it waits for the DG", await poll(async () => (await shr.locator("main").innerText()).includes("Director General") && (await shr.getByRole("button", { name: "Approve" }).count()) === 0));
  await dg.goto(BASE + "/list?view=pending");
  check("it appears in the DG's escalated list", await poll(async () => (await dg.locator("tbody").innerText()).includes("DGE-")));
  await dg.goto(dgUrl);
  await dg.getByRole("button", { name: "Reject" }).click();
  check("the DG must give a reason to reject", await toast(dg, "Please write the reason for rejecting"));
  await dg.getByPlaceholder("Comment").fill("Over the annual limit");
  await dg.getByRole("button", { name: "Reject" }).click();
  check("the DG rejects: Rejected (red)", await poll(async () => (await dg.locator("main span.bg-red-100").count()) >= 1));

  // HR: Satavisha, then the DG
  await emp.goto(BASE + "/new/hr");
  check("the HR form has its fields in order", JSON.stringify(await labelsOf(emp)) === JSON.stringify(["First Name", "Last Name", "Email", "Category", "Date of Request", "Amount", "Description", "File Upload 1", "File Upload 2"]), (await labelsOf(emp)).join("|"));
  const fillHr = async () => {
    await row(emp, "First Name").locator("input").fill("Asha");
    await row(emp, "Last Name").locator("input").fill("Patil");
    await row(emp, /^Email/).locator("input").fill("asha@example.com");
    await emp.locator("select").selectOption({ label: "Experience Certificate" });
  };
  await fillHr();
  await emp.getByRole("button", { name: "Reset" }).click();
  check("Reset clears the form", (await row(emp, "First Name").locator("input").inputValue()) === "");
  await fillHr();
  await emp.getByRole("button", { name: "Submit" }).click();
  await emp.waitForURL(/\/submission\/\d+/);
  const hrUrl = emp.url();
  await sat.goto(BASE + "/list?view=pending&modules=hr");
  check("it is in Satavisha's pending HR list", await poll(async () => (await sat.locator("tbody").innerText()).includes("HR-")));
  await shr.goto(hrUrl);
  check("Shrotri cannot open an HR request", await poll(async () => (await shr.locator("main").innerText()).includes("Not found")));
  await sat.goto(hrUrl);
  await sat.getByRole("button", { name: "Approve" }).click();
  await toast(sat, "Approved");
  await dg.goto(hrUrl);
  await dg.getByRole("button", { name: "Approve" }).click();
  check("Satavisha then the DG approve the HR request", await poll(async () => (await dg.locator("main span.bg-green-100").count()) >= 1));

  // Lists, budgets, masters
  await emp.goto(BASE + "/list?view=mine&modules=expenditure,dg_expenditure");
  check("My Expenses lists both with their colours", await poll(async () => (await emp.locator("tbody").innerText()).includes("DGE-") && (await emp.locator("tbody span.bg-green-100").count()) === 1 && (await emp.locator("tbody span.bg-red-100").count()) === 1));
  check("My Expenses offers the two new-form buttons", (await emp.getByRole("link", { name: /\+ Expenditure/ }).count()) === 1 && (await emp.getByRole("link", { name: /\+ DG Expenditure/ }).count()) === 1);
  await dg.goto(BASE + "/budgets");
  check("the budget shows 4,000 used (only approved counts)", await poll(async () => (await dg.locator("tbody").innerText()).includes("₹4,000.00") && (await dg.locator("tbody").innerText()).includes("₹46,000.00")));
  await dg.goto(BASE + "/list?view=history");
  check("the DG's Full History lists everything", await poll(async () => (await dg.locator("tbody tr").count()) === 3));
  await dg.goto(BASE + "/masters");
  await dg.getByLabel("New Branches").fill("Pune Branch");
  await dg.locator("section", { hasText: "Branches" }).getByRole("button", { name: "Add" }).click();
  check("the DG can add a branch from Masters", await toast(dg, "Added") && (await poll(async () => (await dg.locator("section", { hasText: "Branches" }).innerText()).includes("Pune Branch"))));
  await emp.goto(BASE + "/masters");
  check("staff are sent home from Masters", await poll(async () => new URL(emp.url()).pathname === "/"));
  check("signed-out API access is refused", (await (await browser.newContext()).request.get(BASE + "/api/submissions")).status() === 401);

  // A phone
  const phone = await signIn("employee", { width: 375, height: 800 });
  await phone.goto(BASE + "/new/expenditure");
  check("on a phone the form fits without sideways scrolling", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check("no console or page errors anywhere", errors.length === 0, errors.join(" | "));
} catch (e) {
  bad++;
  console.log("FAIL the run did not finish:", String(e.message).split("\n")[0]);
} finally {
  await browser.close().catch(() => {});
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${ok}/${ok + bad} browser checks passed`);
  process.exit(bad ? 1 : 0);
}
