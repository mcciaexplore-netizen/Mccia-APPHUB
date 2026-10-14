import Database from "better-sqlite3";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(ROOT, "uploads");
const DB_DIR = path.join(ROOT, "database");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DB_DIR, { recursive: true });

export const db = new Database(process.env.DB_FILE ?? path.join(DB_DIR, "mccia.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('staff','approver','dg')), password_hash TEXT NOT NULL,
  can_manage INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, UNIQUE(name));
CREATE TABLE IF NOT EXISTS branches (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS hr_categories (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS publication_types (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY, publication_type INTEGER NOT NULL REFERENCES publication_types(id), name TEXT NOT NULL,
  UNIQUE(publication_type, name)
);
-- Money is stored as whole paise, never as a decimal number.
CREATE TABLE IF NOT EXISTS budgets (
  branch_id INTEGER NOT NULL REFERENCES branches(id), category_id INTEGER NOT NULL REFERENCES categories(id),
  allocated_paise INTEGER NOT NULL CHECK (allocated_paise >= 0), PRIMARY KEY (branch_id, category_id)
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY, module TEXT NOT NULL, ref_no TEXT UNIQUE, submitter_id INTEGER NOT NULL REFERENCES users(id),
  data TEXT NOT NULL, amount_paise INTEGER, branch_id INTEGER, category_id INTEGER,
  status TEXT NOT NULL, stages TEXT NOT NULL, stage_index INTEGER NOT NULL DEFAULT 0, current_approver TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS submissions_status_idx ON submissions(status, current_approver);
CREATE INDEX IF NOT EXISTS submissions_submitter_idx ON submissions(submitter_id);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY, submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  field TEXT NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  actor_id INTEGER, actor_name TEXT NOT NULL, action TEXT NOT NULL, comment TEXT,
  from_status TEXT, to_status TEXT, created_at TEXT NOT NULL
);
`);

/* ---------------------------------------------------------------- passwords */

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(pw, salt, 32).toString("base64")}`;
}
export function checkPassword(pw, stored) {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt") return false;
  const want = Buffer.from(hash, "base64");
  const got = scryptSync(pw, Buffer.from(salt, "base64"), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}

/* ---------------------------------------------------------------- seed (only fills what is empty) */

const CATEGORIES = [
  "Admin Expenses", "AEFC", "Books & Periodicals", "Certificate of Origin", "Commission paid", "Communication", "Digitization",
  "Exhibition and Conference", "Housekeeping expenses", "Insurance", "Leadership Development Program - IIMA", "Learning and Development",
  "Legal and professional fees", "Marketing", "MCCIA Recording Studio", "MCCIA Youth Fellowship 2024 - Hiring Process", "Meeting expenses",
  "Membership Certificate Frames", "Membership Meet", "Membership renewal", "Membership to Organisation", "MIDC Sub-Letting Charges",
  "Miscellaneous expenses", "Office expenses", "Office Revamp", "Other", "Payments to auditors", "Power and fuel", "Programs Activities",
  "Publication", "Rates and Taxes", "Repairs and Maintenance", "Safety", "Security Charges", "Travel Expense", "Travelling and conveyance",
  "Website expenses", "Workshop on AI Tools for Employees", "Workshop on use of AI Tools for Employees",
];
const HR_CATEGORIES = ["Experience Certificate", "Letter Draft (Offer Letter)", "Certificate", "Circular", "Celebration", "Expenses"];
// Placeholder addresses: change them in the users table (or tell me the real ones).
const USERS = [
  { username: "employee", name: "Employee", email: "employee@mccia.local", role: "staff", can_manage: 0 },
  { username: "shrotri", name: "Shrotri Sir", email: "shrotri@mccia.local", role: "approver", can_manage: 1 },
  { username: "satavisha", name: "Satavisha Ma'am", email: "satavisha@mccia.local", role: "approver", can_manage: 0 },
  { username: "dg", name: "Director General", email: "dg@mccia.local", role: "dg", can_manage: 1 },
];
export const DEFAULT_PASSWORD = "mccia123";

const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
db.transaction(() => {
  if (count("users") === 0) {
    const ins = db.prepare("INSERT INTO users (username, name, email, role, password_hash, can_manage) VALUES (?,?,?,?,?,?)");
    for (const u of USERS) ins.run(u.username, u.name, u.email, u.role, hashPassword(DEFAULT_PASSWORD), u.can_manage);
  }
  if (count("employees") === 0) {
    const ins = db.prepare("INSERT INTO employees (name, email) VALUES (?,?)");
    for (const u of USERS) ins.run(u.name, u.email);
  }
  if (count("categories") === 0) for (const n of CATEGORIES) db.prepare("INSERT INTO categories (name) VALUES (?)").run(n);
  if (count("hr_categories") === 0) for (const n of HR_CATEGORIES) db.prepare("INSERT INTO hr_categories (name) VALUES (?)").run(n);
  if (count("branches") === 0) db.prepare("INSERT INTO branches (name) VALUES (?)").run("Head Office");
})();

/* ---------------------------------------------------------------- money and time */

export const toPaise = (rupees) => Math.round(Number(rupees) * 100);
export const toRupees = (paise) => (paise == null ? null : paise / 100);
export const now = () => new Date().toISOString();
