/**
 * API test: starts the real server on a throwaway database and walks every approval route.
 * Run: npm test   (nothing here touches database/mccia.db or uploads/)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mccia-test-"));
process.env.DB_FILE = path.join(tmp, "test.db");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
process.env.SESSION_SECRET = "test-secret";

const { createApp } = await import("./app.js");
const { db } = await import("./db.js");
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let ok = 0, bad = 0;
const check = (name, pass, extra = "") => { if (pass) ok++; else bad++; console.log(pass ? "PASS" : "FAIL", name, pass || extra === "" ? "" : `\n   -> ${typeof extra === "string" ? extra : JSON.stringify(extra)}`); };

/** One signed-in person: remembers the session cookie. */
async function login(username, password = "mccia123") {
  let cookie = "";
  const call = async (method, url, body, form) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, json: type.includes("json") ? await res.json() : null, text: type.includes("json") ? "" : await res.text() };
  };
  const r = await call("POST", "/api/login", { username, password });
  return { call, status: r.status, user: r.json?.user };
}
const formOf = (payload, files = {}) => {
  const f = new FormData();
  f.set("payload", JSON.stringify(payload));
  for (const [field, [name, content]] of Object.entries(files)) f.set(field, new Blob([content]), name);
  return f;
};

try {
  // Logging in
  check("wrong password is refused", (await login("employee", "nope")).status === 401);
  const staff = await login("employee");
  const shrotri = await login("shrotri");
  const satavisha = await login("satavisha");
  const dg = await login("dg");
  check("all four people can sign in with the starting password", [staff, shrotri, satavisha, dg].every((p) => p.status === 200));
  check("roles are as specified", staff.user.role === "staff" && shrotri.user.role === "approver" && satavisha.user.role === "approver" && dg.user.role === "dg");
  check("signed-out requests are refused", (await (await login("nobody")).call("GET", "/api/config")).status === 401);

  // Setup
  const cfg = (await staff.call("GET", "/api/config")).json;
  check("config carries the five modules and the lists", Object.keys(cfg.modules).length === 5 && cfg.lists.categories.length === 39 && cfg.lists.hr_categories.length === 6 && cfg.lists.employees.length === 4);
  const branchId = cfg.lists.branches[0].id;
  const cat = (name) => cfg.lists.categories.find((c) => c.name === name).id;
  const emp = cfg.lists.employees.find((e) => e.name === "Employee");
  check("branches can be added by an administrator but not by staff", (await staff.call("POST", "/api/masters/branches", { name: "ZZ" })).status === 403 && (await dg.call("POST", "/api/masters/branches", { name: "Pune" })).status === 201);
  const type = (await shrotri.call("POST", "/api/masters/publication_types", { name: "Magazine" })).json;
  const pub = (await shrotri.call("POST", "/api/masters/publications", { publication_type: type.id, name: "Udyog" })).json;
  check("publication types and publications can be added", !!type?.id && !!pub?.id);
  check("a duplicate is refused", (await dg.call("POST", "/api/masters/branches", { name: "Pune" })).status === 409);

  // Budget
  const adminCat = cat("Marketing");
  check("staff cannot set a budget", (await staff.call("PUT", "/api/budgets", { branch_id: branchId, category_id: adminCat, allocated: 50000 })).status === 403);
  check("the DG sets a 50,000 budget", (await dg.call("PUT", "/api/budgets", { branch_id: branchId, category_id: adminCat, allocated: 50000 })).status === 200);
  const b0 = (await staff.call("GET", `/api/budget?branch=${branchId}&category=${adminCat}`)).json;
  check("the form sees allocated 50,000, used 0, available 50,000", b0.allocated === 50000 && b0.used === 0 && b0.available === 50000, b0);

  // Expenditure below 10,000: Shrotri only
  const exp = (extra = {}) => ({ name: emp.id, category: adminCat, branch: branchId, vendor: "ZZ Vendor", amount: 4000, nature: "Banners", ...extra });
  const r1 = await staff.call("POST", "/api/submissions/expenditure", null, formOf(exp(), { tax_invoice: ["invoice.pdf", "%PDF-1.4 test"] }));
  check("a 4,000 expenditure is accepted with a reference number", r1.status === 201 && /^EXP-\d{4}$/.test(r1.json.ref_no), r1.json);
  const d1 = (await staff.call("GET", `/api/submissions/${r1.json.id}`)).json;
  check("it waits for Shrotri, in one step", d1.status === "Pending" && d1.current_approver === "Shrotri Sir" && d1.stages.length === 1);
  check("the server worked out the budget: remaining 46,000", d1.data.available_budget === 50000 && d1.data.budget_remaining === 46000, d1.data);
  check("the email was filled from the chosen person", d1.data.email === emp.email);
  check("the attached file is listed", d1.files.find((f) => f.key === "tax_invoice")?.file?.original_name === "invoice.pdf");
  const dl = await staff.call("GET", `/api/files/${d1.files.find((f) => f.key === "tax_invoice").file.id}`);
  check("its owner can download it", dl.status === 200 && dl.text.startsWith("%PDF"));
  check("Satavisha (not an approver of expenditures) cannot see it or its file", (await satavisha.call("GET", `/api/submissions/${r1.json.id}`)).status === 404 && (await satavisha.call("GET", `/api/files/${d1.files.find((f) => f.key === "tax_invoice").file.id}`)).status === 404);
  check("a bad file type is refused", (await staff.call("POST", "/api/submissions/expenditure", null, formOf(exp(), { tax_invoice: ["virus.exe", "x"] }))).status === 400);
  check("the 10,000 rule: 10,000 on the below form is refused", (await staff.call("POST", "/api/submissions/expenditure", null, formOf(exp({ amount: 10000 })))).status === 400);
  check("the 10,000 rule: 9,999 on the DG form is refused", (await staff.call("POST", "/api/submissions/dg_expenditure", null, formOf(exp({ amount: 9999 })))).status === 400);
  check("required fields are enforced", (await staff.call("POST", "/api/submissions/expenditure", null, formOf(exp({ vendor: "" })))).status === 400);
  check("a tax invoice dated in the future is refused", (await staff.call("POST", "/api/submissions/expenditure", null, formOf(exp({ tax_invoice_date: "2099-01-01" })))).status === 400);
  check("approvers cannot submit", (await shrotri.call("POST", "/api/submissions/expenditure", null, formOf(exp()))).status === 403);

  check("Shrotri's pending list holds it", (await shrotri.call("GET", "/api/submissions?view=pending&modules=expenditure,dg_expenditure")).json.some((s) => s.id === r1.json.id));
  check("the DG's pending list does not", !(await dg.call("GET", "/api/submissions?view=pending")).json.some((s) => s.id === r1.json.id));
  check("the DG cannot act on it", (await dg.call("POST", `/api/submissions/${r1.json.id}/action`, { action: "approve" })).status === 403);
  check("rejecting needs a reason", (await shrotri.call("POST", `/api/submissions/${r1.json.id}/action`, { action: "reject" })).status === 400);
  check("requesting more info needs a note", (await shrotri.call("POST", `/api/submissions/${r1.json.id}/action`, { action: "more_info" })).status === 400);
  const mi = await shrotri.call("POST", `/api/submissions/${r1.json.id}/action`, { action: "more_info", comment: "Please attach the quotation" });
  check("Shrotri asks for more information", mi.status === 200 && mi.json.status === "More Info Required");
  check("it leaves his pending list and shows blue for staff", !(await shrotri.call("GET", "/api/submissions?view=pending")).json.some((s) => s.id === r1.json.id) && (await staff.call("GET", "/api/counts")).json.info === 1);
  check("only the submitter can resubmit", (await shrotri.call("PUT", `/api/submissions/${r1.json.id}`, null, formOf(exp()))).status === 404);
  const re = await staff.call("PUT", `/api/submissions/${r1.json.id}`, null, formOf(exp({ amount: 4500 }), { quotation: ["quote.pdf", "%PDF-1.4 quote"] }));
  check("staff resubmit with the extra information", re.status === 200);
  const d1b = (await staff.call("GET", `/api/submissions/${r1.json.id}`)).json;
  check("it is pending again, with the new amount, the new file and the old file kept", d1b.status === "Pending" && d1b.amount === 4500 && d1b.files.find((f) => f.key === "quotation").file && d1b.files.find((f) => f.key === "tax_invoice").file, d1b.status);
  check("resubmitting a request that is not waiting for information is refused", (await staff.call("PUT", `/api/submissions/${r1.json.id}`, null, formOf(exp()))).status === 409);
  const ap = await shrotri.call("POST", `/api/submissions/${r1.json.id}/action`, { action: "approve", comment: "ok" });
  check("Shrotri approves: final, since below 10,000", ap.json.status === "Approved");
  check("approving again is refused", (await shrotri.call("POST", `/api/submissions/${r1.json.id}/action`, { action: "approve" })).status === 409);
  const b1 = (await staff.call("GET", `/api/budget?branch=${branchId}&category=${adminCat}`)).json;
  check("only approved spend counts: used 4,500, available 45,500", b1.used === 4500 && b1.available === 45500, b1);
  const audit = (await staff.call("GET", `/api/submissions/${r1.json.id}`)).json.audit.map((a) => a.action);
  check("the audit trail records who did what, in order", JSON.stringify(audit) === JSON.stringify(["Submitted", "Requested more information", "Resubmitted", "Approved"]), audit);

  // DG expenditure: Shrotri then DG
  const r2 = await staff.call("POST", "/api/submissions/dg_expenditure", null, formOf(exp({ amount: 60000, publication_type: type.id, publication: pub.id })));
  check("a 60,000 DG expenditure is accepted", r2.status === 201 && /^DGE-/.test(r2.json.ref_no), r2.json);
  const d2 = (await staff.call("GET", `/api/submissions/${r2.json.id}`)).json;
  check("it computes the difference (negative: over budget) and allocated", d2.data.budget_allocated === 50000 && d2.data.difference === -14500, d2.data);
  check("it goes to Shrotri first, then the DG", d2.current_approver === "Shrotri Sir" && d2.stages.map((s) => s.username).join() === "shrotri,dg");
  check("a publication from another type is refused", (await staff.call("POST", "/api/submissions/dg_expenditure", null, formOf(exp({ amount: 60000, publication_type: type.id, publication: 9999 })))).status === 400);
  check("the DG cannot jump the queue", (await dg.call("POST", `/api/submissions/${r2.json.id}/action`, { action: "approve" })).status === 403);
  check("Shrotri approves and it moves to the DG", (await shrotri.call("POST", `/api/submissions/${r2.json.id}/action`, { action: "approve" })).json.status === "Pending");
  const pend = (await dg.call("GET", "/api/submissions?view=pending")).json;
  check("it appears in the DG's escalated list, no longer in Shrotri's", pend.some((s) => s.id === r2.json.id) && !(await shrotri.call("GET", "/api/submissions?view=pending")).json.some((s) => s.id === r2.json.id));
  check("budget unchanged until the DG approves", (await staff.call("GET", `/api/budget?branch=${branchId}&category=${adminCat}`)).json.used === 4500);
  const [a, b] = await Promise.all([dg.call("POST", `/api/submissions/${r2.json.id}/action`, { action: "approve" }), dg.call("POST", `/api/submissions/${r2.json.id}/action`, { action: "reject", comment: "no" })]);
  check("two decisions at once: exactly one wins", [a.status, b.status].sort().join() === "200,409", [a.status, b.status]);

  // Rejected requests do not count
  const r3 = await staff.call("POST", "/api/submissions/expenditure", null, formOf(exp({ amount: 1000 })));
  await shrotri.call("POST", `/api/submissions/${r3.json.id}/action`, { action: "reject", comment: "Not needed" });
  check("a rejected request is final and uses no budget", (await staff.call("GET", `/api/submissions/${r3.json.id}`)).json.status === "Rejected" && (await staff.call("GET", `/api/budget?branch=${branchId}&category=${adminCat}`)).json.used === (a.status === 200 ? 64500 : 4500));

  // HR: Satavisha then DG
  const hr = { first_name: "Asha", last_name: "Patil", email: "asha@example.com", category: cfg.lists.hr_categories[0].id, amount: 500, description: "Experience certificate" };
  const r4 = await staff.call("POST", "/api/submissions/hr", null, formOf(hr, { file_upload_1: ["note.pdf", "%PDF-1.4"], file_upload_2: ["note2.pdf", "%PDF-1.4"] }));
  check("an HR request is accepted with two files", r4.status === 201 && /^HR-/.test(r4.json.ref_no));
  check("it goes to Satavisha, not Shrotri", (await satavisha.call("GET", "/api/submissions?view=pending")).json.some((s) => s.id === r4.json.id) && !(await shrotri.call("GET", "/api/submissions?view=pending")).json.some((s) => s.id === r4.json.id));
  check("Shrotri cannot see HR requests", (await shrotri.call("GET", `/api/submissions/${r4.json.id}`)).status === 404);
  check("a wrong email on the HR form is refused", (await staff.call("POST", "/api/submissions/hr", null, formOf({ ...hr, email: "nope" }))).status === 400);
  await satavisha.call("POST", `/api/submissions/${r4.json.id}/action`, { action: "approve" });
  check("Satavisha approves, then the DG decides", (await dg.call("POST", `/api/submissions/${r4.json.id}/action`, { action: "approve" })).json.status === "Approved");
  check("Satavisha's Approved list shows it", (await satavisha.call("GET", "/api/submissions?view=approved")).json.some((s) => s.id === r4.json.id));

  // Reimbursement: Shrotri only; Events: DG only above 10,000
  const r5 = await staff.call("POST", "/api/submissions/reimbursement", null, formOf(exp({ amount: 25000 })));
  check("a reimbursement of any size has a single step (Shrotri)", r5.status === 201 && (await shrotri.call("POST", `/api/submissions/${r5.json.id}/action`, { action: "approve" })).json.status === "Approved");
  const ev = { event_name: "Annual Meet", event_date: "2026-12-01", venue: "Pune", attendees: 120, budget_required: 8000, branch: branchId };
  const r6 = await staff.call("POST", "/api/submissions/event", null, formOf(ev));
  check("an event within 10,000 stops at Shrotri", r6.status === 201 && (await shrotri.call("POST", `/api/submissions/${r6.json.id}/action`, { action: "approve" })).json.status === "Approved");
  const r7 = await staff.call("POST", "/api/submissions/event", null, formOf({ ...ev, budget_required: 20000 }));
  check("an event above 10,000 escalates to the DG", (await shrotri.call("POST", `/api/submissions/${r7.json.id}/action`, { action: "approve" })).json.status === "Pending" && (await dg.call("GET", "/api/submissions?view=pending")).json.some((s) => s.id === r7.json.id));
  check("an event needs its name, date and venue", (await staff.call("POST", "/api/submissions/event", null, formOf({ ...ev, venue: "" }))).status === 400);

  // Who sees what
  check("staff see only their own submissions", (await staff.call("GET", "/api/submissions?view=mine")).json.length >= 7 && (await shrotri.call("GET", "/api/submissions?view=mine")).json.length === 0);
  check("staff cannot read the approvers' lists", (await staff.call("GET", "/api/submissions?view=approved")).status === 403);
  check("only the DG has Full History", (await dg.call("GET", "/api/submissions?view=history")).json.length >= 7 && (await shrotri.call("GET", "/api/submissions?view=history")).status === 403);
  check("search finds a reference number", (await dg.call("GET", `/api/submissions?view=history&q=${r4.json.ref_no}`)).json.length === 1);
  check("search treats % as plain text", (await dg.call("GET", "/api/submissions?view=history&q=%25")).json.length === 0);
  check("budgets are readable by administrators only", (await dg.call("GET", "/api/budgets")).json.length === 1 && (await satavisha.call("GET", "/api/budgets")).status === 403);
} catch (e) {
  bad++;
  console.log("FAIL the test ran to the end without an unexpected error\n", e);
} finally {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${ok}/${ok + bad} API checks passed`);
  process.exit(bad ? 1 : 0);
}
