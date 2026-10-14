import express from "express";
import multer from "multer";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT, UPLOAD_DIR, checkPassword, db, now, toPaise, toRupees } from "./db.js";
import { ACTIONS, MODULES, STATUS, THRESHOLD, amountKeyOf, modulesFor, stagesFor } from "./modules.js";

/* ---------------------------------------------------------------- sessions: a signed token in an HttpOnly cookie */

const SECRET_FILE = path.join(ROOT, "database", ".secret");
const SECRET = process.env.SESSION_SECRET ?? (() => {
  try { return fs.readFileSync(SECRET_FILE, "utf8"); } catch {
    const s = randomBytes(32).toString("hex");
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
})();
const COOKIE = "mccia_session";
const SESSION_SECONDS = 12 * 3600;
const sign = (body) => createHmac("sha256", SECRET).update(body).digest("base64url");
const makeToken = (userId) => {
  const body = Buffer.from(JSON.stringify({ u: userId, e: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString("base64url");
  return `${body}.${sign(body)}`;
};
function readToken(token) {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.e > Date.now() / 1000 ? p.u : null;
  } catch { return null; }
}
const cookieOf = (req, name) => (req.headers.cookie ?? "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1];

/* ---------------------------------------------------------------- small helpers */

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (message, status = 400) => new HttpError(status, message);
const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };

const SOURCES = {
  employees: "employees", categories: "categories", hr_categories: "hr_categories", branches: "branches",
  publication_types: "publication_types", publications: "publications",
};
const nameOf = (source, id) => (id == null || id === "" ? null : db.prepare(`SELECT name FROM ${SOURCES[source]} WHERE id = ?`).get(id)?.name ?? null);
const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
const today = () => new Date().toISOString().slice(0, 10);

/** What is allocated for a branch and category, and what approved requests have used. Only approved requests use budget. */
function budgetFor(branchId, categoryId, excludeId = 0) {
  const allocated = db.prepare("SELECT allocated_paise AS p FROM budgets WHERE branch_id = ? AND category_id = ?").get(branchId, categoryId)?.p ?? null;
  const used = db.prepare(
    `SELECT COALESCE(SUM(amount_paise), 0) AS s FROM submissions
     WHERE status = 'Approved' AND module IN ('expenditure','dg_expenditure','reimbursement') AND branch_id = ? AND category_id = ? AND id != ?`,
  ).get(branchId, categoryId, excludeId).s;
  return { allocated, used, available: allocated == null ? null : allocated - used };
}

const refNo = (prefix, id) => `${prefix}-${String(id).padStart(4, "0")}`;

/* ---------------------------------------------------------------- validating a form against its module definition */

function checkSelect(f, value, data) {
  const id = Number(value);
  if (!Number.isInteger(id) || nameOf(f.source, id) == null) return `Choose a valid ${f.label.toLowerCase()}.`;
  if (f.source === "publications" && data.publication_type) {
    const ok = db.prepare("SELECT 1 FROM publications WHERE id = ? AND publication_type = ?").get(id, Number(data.publication_type));
    if (!ok) return "That publication does not belong to the chosen type.";
  }
  return null;
}

/** Returns { errors, data, amount } for a submitted form. `data` holds only what the form is allowed to carry. */
function validate(moduleKey, input) {
  const m = MODULES[moduleKey];
  const errors = {};
  const data = {};
  for (const f of m.fields) {
    if (f.type === "file" || f.type === "computed") continue;
    if (f.auto === "now") { data[f.key] = now(); continue; }
    if (f.auto === "employeeEmail") continue; // filled in below from the chosen person
    let v = input[f.key];
    v = typeof v === "string" ? v.trim() : v;
    const empty = v === undefined || v === null || v === "";
    if (empty) { if (f.required) errors[f.key] = `${f.label} is required.`; continue; }
    if (f.type === "select") { const e = checkSelect(f, v, input); if (e) errors[f.key] = e; else data[f.key] = Number(v); }
    else if (f.type === "money") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6 || n > 1e9) errors[f.key] = `${f.label} must be an amount with at most 2 decimals.`;
      else if (f.required && n <= 0) errors[f.key] = `${f.label} must be more than 0.`;
      else data[f.key] = n;
    } else if (f.type === "number") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) errors[f.key] = `${f.label} must be a whole number.`; else data[f.key] = n;
    } else if (f.type === "date") {
      if (!isDay(v)) errors[f.key] = `${f.label} must be a valid date.`;
      else if (f.key === "tax_invoice_date" && v > today()) errors[f.key] = "The date of the tax invoice cannot be in the future.";
      else data[f.key] = v;
    } else if (f.type === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 200) errors[f.key] = "Enter a valid email address."; else data[f.key] = v;
    } else {
      if (String(v).length > 4000) errors[f.key] = `${f.label} is too long.`; else data[f.key] = String(v);
    }
  }
  if (data.name) data.email = db.prepare("SELECT email FROM employees WHERE id = ?").get(data.name)?.email ?? "";

  const amount = data[amountKeyOf(moduleKey)] ?? null;
  const key = amountKeyOf(moduleKey);
  if (amount != null && !errors[key]) {
    if (moduleKey === "expenditure" && amount >= THRESHOLD) errors[key] = "Amounts of ₹10,000 and above must be submitted through DG Approval: Expenditure.";
    if (moduleKey === "dg_expenditure" && amount < THRESHOLD) errors[key] = "Amounts below ₹10,000 must be submitted through the Expenditure form.";
  }

  if (m.budget && data.branch && data.category && amount != null) {
    const b = budgetFor(data.branch, data.category);
    data.budget_allocated = b.allocated == null ? null : toRupees(b.allocated);
    data.available_budget = b.available == null ? null : toRupees(b.available);
    data.budget_remaining = b.available == null ? null : toRupees(b.available - toPaise(amount));
    data.difference = data.budget_remaining;
  }
  return { errors, data, amount };
}

/* ---------------------------------------------------------------- how a submission looks to the outside */

const displayOf = (f, value) => {
  if (value === undefined || value === null || value === "") return "";
  if (f.type === "select") return nameOf(f.source, value) ?? "";
  return value;
};

function summaryOf(row, data) {
  const m = MODULES[row.module];
  if (row.module === "hr") return `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() + (data.category ? ` · ${nameOf("hr_categories", data.category)}` : "");
  if (row.module === "event") return data.event_name ?? "";
  const cat = data.category ? nameOf("categories", data.category) : "";
  return [cat, data.branch ? nameOf("branches", data.branch) : ""].filter(Boolean).join(" · ") || m.short;
}

const userName = (id) => db.prepare("SELECT name FROM users WHERE id = ?").get(id)?.name ?? "";
const approverName = (username) => (username ? db.prepare("SELECT name FROM users WHERE username = ?").get(username)?.name ?? username : null);

function rowOut(r) {
  const data = JSON.parse(r.data);
  return {
    id: r.id, ref_no: r.ref_no, module: r.module, module_label: MODULES[r.module].short, summary: summaryOf(r, data),
    submitter: userName(r.submitter_id), amount: toRupees(r.amount_paise), status: r.status, current_approver: approverName(r.current_approver),
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

const canView = (user, r) => r.submitter_id === user.id || user.role === "dg" || JSON.parse(r.stages).includes(user.username);

/* ---------------------------------------------------------------- the app */

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); next(); });
  app.use(express.json({ limit: "100kb" }));

  const upload = multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (_req, file, cb) => cb(null, `${randomBytes(12).toString("hex")}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => (/\.(pdf|jpe?g|png|docx?|xlsx?)$/i.test(file.originalname) ? cb(null, true) : cb(bad("Only PDF, JPG, PNG, DOC, DOCX, XLS and XLSX files are allowed."))),
  });

  /* ---- login */
  const attempts = new Map();
  app.post("/api/login", wrap((req, res) => {
    const ip = req.ip ?? "?";
    const a = attempts.get(ip) ?? { n: 0, since: Date.now() };
    if (Date.now() - a.since > 60_000) { a.n = 0; a.since = Date.now(); }
    if (++a.n > 10) throw bad("Too many attempts. Wait a minute and try again.", 429);
    attempts.set(ip, a);
    const { username, password } = req.body ?? {};
    const u = db.prepare("SELECT * FROM users WHERE username = ?").get(String(username ?? "").trim().toLowerCase());
    if (!u || !checkPassword(String(password ?? ""), u.password_hash)) throw bad("Wrong username or password.", 401);
    res.setHeader("Set-Cookie", `${COOKIE}=${makeToken(u.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`);
    res.json({ user: publicUser(u) });
  }));
  app.post("/api/logout", (_req, res) => { res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); res.json({ ok: true }); });

  const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, email: u.email, role: u.role, can_manage: !!u.can_manage });
  const auth = wrap((req, _res, next) => {
    const id = readToken(cookieOf(req, COOKIE));
    const u = id ? db.prepare("SELECT * FROM users WHERE id = ?").get(id) : null;
    if (!u) throw bad("Please sign in.", 401);
    req.user = u;
    next();
  });
  const manager = (req, _res, next) => (req.user.can_manage ? next() : next(bad("Only an administrator can do that.", 403)));

  app.get("/api/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));

  /* ---- everything the client needs to draw the forms */
  const lists = () => ({
    employees: db.prepare("SELECT id, name, email FROM employees ORDER BY name").all(),
    categories: db.prepare("SELECT id, name FROM categories ORDER BY name").all(),
    hr_categories: db.prepare("SELECT id, name FROM hr_categories ORDER BY name").all(),
    branches: db.prepare("SELECT id, name FROM branches ORDER BY name").all(),
    publication_types: db.prepare("SELECT id, name FROM publication_types ORDER BY name").all(),
    publications: db.prepare("SELECT id, name, publication_type FROM publications ORDER BY name").all(),
  });
  app.get("/api/config", auth, (_req, res) => res.json({
    threshold: THRESHOLD,
    modules: Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, { key: k, label: m.label, short: m.short, fields: m.fields, amountKey: amountKeyOf(k) }])),
    lists: lists(),
  }));

  /* ---- masters and budgets (administrators) */
  app.post("/api/masters/:kind", auth, manager, wrap((req, res) => {
    const kind = req.params.kind;
    if (!SOURCES[kind]) throw bad("Unknown list.", 404);
    const name = String(req.body?.name ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 120) throw bad("Enter a name (up to 120 characters).");
    try {
      let info;
      if (kind === "publications") {
        const type = Number(req.body?.publication_type);
        if (!nameOf("publication_types", type)) throw bad("Choose the type of publication first.");
        info = db.prepare("INSERT INTO publications (publication_type, name) VALUES (?, ?)").run(type, name);
      } else if (kind === "employees") {
        const email = String(req.body?.email ?? "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Enter the employee's email address.");
        info = db.prepare("INSERT INTO employees (name, email) VALUES (?, ?)").run(name, email);
      } else info = db.prepare(`INSERT INTO ${SOURCES[kind]} (name) VALUES (?)`).run(name);
      res.status(201).json({ id: Number(info.lastInsertRowid), name });
    } catch (e) {
      if (String(e.code).startsWith("SQLITE_CONSTRAINT")) throw bad("That already exists.", 409);
      throw e;
    }
  }));

  app.get("/api/budget", auth, wrap((req, res) => {
    const branch = Number(req.query.branch), category = Number(req.query.category);
    if (!Number.isInteger(branch) || !Number.isInteger(category)) throw bad("Choose a branch and a category.");
    const b = budgetFor(branch, category, Number(req.query.exclude) || 0);
    res.json({ allocated: toRupees(b.allocated), used: toRupees(b.used), available: toRupees(b.available) });
  }));
  app.get("/api/budgets", auth, manager, (_req, res) => {
    const rows = db.prepare(
      `SELECT b.branch_id, br.name AS branch, b.category_id, c.name AS category, b.allocated_paise FROM budgets b
       JOIN branches br ON br.id = b.branch_id JOIN categories c ON c.id = b.category_id ORDER BY br.name, c.name`,
    ).all();
    res.json(rows.map((r) => ({ ...r, allocated: toRupees(r.allocated_paise), used: toRupees(budgetFor(r.branch_id, r.category_id).used) })));
  });
  app.put("/api/budgets", auth, manager, wrap((req, res) => {
    const { branch_id, category_id, allocated } = req.body ?? {};
    const n = Number(allocated);
    if (!nameOf("branches", branch_id) || !nameOf("categories", category_id)) throw bad("Choose a branch and a category.");
    if (!Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw bad("The budget must be an amount with at most 2 decimals.");
    db.prepare(
      `INSERT INTO budgets (branch_id, category_id, allocated_paise) VALUES (?, ?, ?)
       ON CONFLICT (branch_id, category_id) DO UPDATE SET allocated_paise = excluded.allocated_paise`,
    ).run(Number(branch_id), Number(category_id), toPaise(n));
    res.json({ ok: true });
  }));

  /* ---- submissions */
  const parsePayload = (req) => {
    try { return JSON.parse(req.body?.payload ?? "{}"); } catch { throw bad("The form data could not be read."); }
  };
  const cleanupFiles = (files) => files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
  const fileFields = (m) => new Set(m.fields.filter((f) => f.type === "file").map((f) => f.key));

  const saveFiles = (id, moduleKey, files) => {
    const allowed = fileFields(MODULES[moduleKey]);
    for (const f of files) {
      if (!allowed.has(f.fieldname)) { cleanupFiles([f]); continue; }
      const old = db.prepare("SELECT id, stored_name FROM attachments WHERE submission_id = ? AND field = ?").get(id, f.fieldname);
      if (old) { db.prepare("DELETE FROM attachments WHERE id = ?").run(old.id); fs.rm(path.join(UPLOAD_DIR, old.stored_name), { force: true }, () => {}); }
      db.prepare("INSERT INTO attachments (submission_id, field, original_name, stored_name, size) VALUES (?,?,?,?,?)")
        .run(id, f.fieldname, path.basename(f.originalname).slice(0, 150), f.filename, f.size);
    }
  };
  const addAudit = (id, actor, action, comment, from, to) =>
    db.prepare("INSERT INTO audit (submission_id, actor_id, actor_name, action, comment, from_status, to_status, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, actor.id, actor.name, action, comment ?? null, from ?? null, to ?? null, now());

  app.post("/api/submissions/:module", auth, upload.any(), wrap((req, res) => {
    const files = req.files ?? [];
    try {
      const moduleKey = req.params.module;
      if (!MODULES[moduleKey]) throw bad("Unknown form.", 404);
      if (req.user.role !== "staff") throw bad("Only staff submit these forms.", 403);
      const { errors, data, amount } = validate(moduleKey, parsePayload(req));
      if (Object.keys(errors).length) { const e = bad(Object.values(errors)[0]); e.errors = errors; throw e; }
      const stages = stagesFor(moduleKey, amount ?? 0);
      const id = db.transaction(() => {
        const info = db.prepare(
          `INSERT INTO submissions (module, submitter_id, data, amount_paise, branch_id, category_id, status, stages, stage_index, current_approver, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,0,?,?,?)`,
        ).run(moduleKey, req.user.id, JSON.stringify(data), amount == null ? null : toPaise(amount), data.branch ?? null, data.category ?? null, STATUS.PENDING, JSON.stringify(stages), stages[0], now(), now());
        const newId = Number(info.lastInsertRowid);
        db.prepare("UPDATE submissions SET ref_no = ? WHERE id = ?").run(refNo(MODULES[moduleKey].prefix, newId), newId);
        saveFiles(newId, moduleKey, files);
        addAudit(newId, req.user, "Submitted", null, null, STATUS.PENDING);
        return newId;
      })();
      res.status(201).json({ id, ref_no: refNo(MODULES[moduleKey].prefix, id) });
    } catch (e) { cleanupFiles(files); throw e; }
  }));

  /** The person who raised it answers a "more info" request: the form is saved again and goes back to the same approver. */
  app.put("/api/submissions/:id", auth, upload.any(), wrap((req, res) => {
    const files = req.files ?? [];
    try {
      const r = db.prepare("SELECT * FROM submissions WHERE id = ?").get(Number(req.params.id));
      if (!r || r.submitter_id !== req.user.id) throw bad("Not found.", 404);
      if (r.status !== STATUS.INFO) throw bad("This request is not waiting for more information.", 409);
      const { errors, data, amount } = validate(r.module, parsePayload(req));
      if (Object.keys(errors).length) { const e = bad(Object.values(errors)[0]); e.errors = errors; throw e; }
      const stages = stagesFor(r.module, amount ?? 0);
      const idx = Math.min(r.stage_index, stages.length - 1);
      db.transaction(() => {
        db.prepare(
          `UPDATE submissions SET data = ?, amount_paise = ?, branch_id = ?, category_id = ?, status = ?, stages = ?, stage_index = ?, current_approver = ?, updated_at = ? WHERE id = ?`,
        ).run(JSON.stringify(data), amount == null ? null : toPaise(amount), data.branch ?? null, data.category ?? null, STATUS.PENDING, JSON.stringify(stages), idx, stages[idx], now(), r.id);
        saveFiles(r.id, r.module, files);
        addAudit(r.id, req.user, "Resubmitted", req.body?.note ? String(req.body.note).slice(0, 2000) : null, STATUS.INFO, STATUS.PENDING);
      })();
      res.json({ id: r.id, ref_no: r.ref_no });
    } catch (e) { cleanupFiles(files); throw e; }
  }));

  app.get("/api/submissions", auth, wrap((req, res) => {
    const { view = "mine", q = "" } = req.query;
    const asked = String(req.query.modules ?? "").split(",").filter((k) => MODULES[k]);
    const u = req.user;
    const where = [], args = [];
    if (view === "mine") { where.push("submitter_id = ?"); args.push(u.id); }
    else if (view === "pending") { where.push("status = ? AND current_approver = ?"); args.push(STATUS.PENDING, u.username); }
    else if (view === "approved" || view === "rejected") {
      const mine = modulesFor(u.username, u.role);
      if (!mine.length || u.role === "staff") throw bad("Not allowed.", 403);
      where.push("status = ?", `module IN (${mine.map(() => "?").join(",")})`);
      args.push(view === "approved" ? STATUS.APPROVED : STATUS.REJECTED, ...mine);
    } else if (view === "history") {
      if (u.role !== "dg") throw bad("Only the DG sees the full history.", 403);
    } else throw bad("Unknown list.", 400);
    if (asked.length) { where.push(`module IN (${asked.map(() => "?").join(",")})`); args.push(...asked); }
    if (String(q).trim()) { where.push("(ref_no LIKE ? ESCAPE '\\' OR data LIKE ? ESCAPE '\\')"); const like = `%${String(q).trim().replace(/[\\%_]/g, "\\$&")}%`; args.push(like, like); }
    const rows = db.prepare(`SELECT * FROM submissions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC, id DESC LIMIT 500`).all(...args);
    res.json(rows.map(rowOut));
  }));

  app.get("/api/counts", auth, (req, res) => {
    const u = req.user;
    const rows = db.prepare("SELECT module, COUNT(*) AS n FROM submissions WHERE status = ? AND current_approver = ? GROUP BY module").all(STATUS.PENDING, u.username);
    const info = db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE status = ? AND submitter_id = ?").get(STATUS.INFO, u.id).n;
    res.json({ pending: Object.fromEntries(rows.map((r) => [r.module, r.n])), info });
  });

  app.get("/api/submissions/:id", auth, wrap((req, res) => {
    const r = db.prepare("SELECT * FROM submissions WHERE id = ?").get(Number(req.params.id));
    if (!r || !canView(req.user, r)) throw bad("Not found.", 404);
    const m = MODULES[r.module];
    const data = JSON.parse(r.data);
    const attachments = db.prepare("SELECT id, field, original_name, size FROM attachments WHERE submission_id = ?").all(r.id);
    const stages = JSON.parse(r.stages);
    res.json({
      ...rowOut(r),
      data,
      fields: m.fields.filter((f) => f.type !== "file").map((f) => ({ key: f.key, label: f.label, type: f.type, value: displayOf(f, data[f.key]) })),
      files: m.fields.filter((f) => f.type === "file").map((f) => ({ key: f.key, label: f.label, file: attachments.find((a) => a.field === f.key) ?? null })),
      stages: stages.map((s, i) => ({ username: s, name: approverName(s), state: i < r.stage_index || r.status === STATUS.APPROVED ? "done" : i === r.stage_index ? (r.status === STATUS.REJECTED ? "rejected" : "current") : "later" })),
      audit: db.prepare("SELECT actor_name, action, comment, from_status, to_status, created_at FROM audit WHERE submission_id = ? ORDER BY id").all(r.id),
      can: { act: r.status === STATUS.PENDING && r.current_approver === req.user.username, resubmit: r.status === STATUS.INFO && r.submitter_id === req.user.id },
    });
  }));

  app.post("/api/submissions/:id/action", auth, wrap((req, res) => {
    const r = db.prepare("SELECT * FROM submissions WHERE id = ?").get(Number(req.params.id));
    if (!r || !canView(req.user, r)) throw bad("Not found.", 404);
    const action = req.body?.action;
    const comment = String(req.body?.comment ?? "").trim().slice(0, 2000);
    if (!ACTIONS[action]) throw bad("Choose approve, reject or request more information.");
    if ((action === "reject" || action === "more_info") && !comment) throw bad(action === "reject" ? "Please write the reason for rejecting." : "Please say what information is needed.");
    const stages = JSON.parse(r.stages);
    const last = r.stage_index >= stages.length - 1;
    const to = action === "approve" ? (last ? STATUS.APPROVED : STATUS.PENDING) : ACTIONS[action];
    // One conditional update claims the decision, so two people clicking at once cannot both succeed.
    const claimed = db.prepare(
      `UPDATE submissions SET status = ?, stage_index = ?, current_approver = ?, updated_at = ?
       WHERE id = ? AND status = ? AND current_approver = ? AND stage_index = ?`,
    ).run(to, action === "approve" && !last ? r.stage_index + 1 : r.stage_index, action === "approve" && !last ? stages[r.stage_index + 1] : null, now(), r.id, STATUS.PENDING, req.user.username, r.stage_index);
    if (claimed.changes === 0) throw bad(r.status !== STATUS.PENDING ? `This request is already ${r.status.toLowerCase()}.` : "This request is not waiting for you.", r.status !== STATUS.PENDING ? 409 : 403);
    addAudit(r.id, req.user, action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Requested more information", comment || null, STATUS.PENDING, to);
    res.json({ status: to });
  }));

  app.get("/api/files/:id", auth, wrap((req, res) => {
    const a = db.prepare("SELECT * FROM attachments WHERE id = ?").get(Number(req.params.id));
    const r = a && db.prepare("SELECT * FROM submissions WHERE id = ?").get(a.submission_id);
    if (!a || !r || !canView(req.user, r)) throw bad("Not found.", 404);
    res.download(path.join(UPLOAD_DIR, a.stored_name), a.original_name);
  }));

  /* ---- the built client, when there is one */
  const dist = path.join(ROOT, "client", "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use("/api", (_req, _res, next) => next(bad("Not found.", 404)));
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Files can be at most 10 MB." : err.message });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, errors: err.errors });
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });
  return app;
}
