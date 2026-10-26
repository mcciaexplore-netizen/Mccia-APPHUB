import { toCsv } from "@/lib/csv";

/**
 * Turns a table of cells (from a CSV or an Excel file) into import rows. Pure and safe to run in the browser and on the server.
 * Nothing in here touches the database: whether a branch, team or manager really exists is checked by src/lib/import.ts.
 */
export type ImportRow = {
  /** The row's number among the people in the file (the first person is row 1), used in every message. */
  row: number;
  name: string; email: string; branch: string; team: string; manager: string; role: string; applications: string; designation: string;
};

export const MAX_IMPORT_ROWS = 2000;
export const MAX_FILE_BYTES = 2_000_000;
export const COLUMNS = ["name", "email", "branch", "team", "reporting_manager", "role", "applications", "designation"] as const;

const ALIASES: Record<(typeof COLUMNS)[number], string[]> = {
  name: ["name", "full_name", "fullname", "user_name", "employee_name"],
  email: ["email", "email_address", "emailaddress", "e_mail", "e_mail_address", "mail", "username", "user_email"],
  branch: ["branch", "office", "location", "branch_name"],
  team: ["team", "team_name", "group"],
  reporting_manager: ["reporting_manager", "manager", "reporting_manager_email", "manager_email", "reports_to", "reporting_to", "team_lead"],
  role: ["role", "user_role", "access_role"],
  applications: ["applications", "apps", "application", "app", "applications_to_assign"],
  designation: ["designation", "job_title", "title", "position"],
};
const PASSWORD_HEADERS = new Set(["password", "passwd", "pwd", "pass", "initial_password", "temp_password", "temporary_password", "default_password"]);

const key = (h: string) => h.trim().toLowerCase().replace(/[\s\-./]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/^_+|_+$/g, "");

export type ParsedTable = { rows: ImportRow[]; problem?: string; ignoredColumns: string[] };

export function tableToRows(table: string[][]): ParsedTable {
  const data = table.filter((r) => !(r[0] ?? "").trim().startsWith("#") && r.some((c) => (c ?? "").trim() !== ""));
  if (data.length < 2) return { rows: [], ignoredColumns: [], problem: "The file needs a header row and at least one person." };
  const head = data[0].map(key);
  if (head.some((h) => PASSWORD_HEADERS.has(h))) {
    return { rows: [], ignoredColumns: [], problem: "Remove the password column. People choose their own password from a link sent to them, so passwords must never be written in a file." };
  }
  const index = {} as Record<(typeof COLUMNS)[number], number>;
  for (const c of COLUMNS) index[c] = head.findIndex((h) => ALIASES[c].includes(h));
  if (index.name < 0 || index.email < 0) return { rows: [], ignoredColumns: [], problem: 'The first row must contain the columns "name" and "email".' };
  const used = new Set(Object.values(index));
  const ignoredColumns = data[0].filter((_, i) => !used.has(i) && data[0][i].trim() !== "").map((h) => h.trim());
  if (data.length - 1 > MAX_IMPORT_ROWS) return { rows: [], ignoredColumns, problem: `At most ${MAX_IMPORT_ROWS} people per file. Split it into smaller files.` };
  const cell = (r: string[], c: (typeof COLUMNS)[number]) => (index[c] >= 0 ? (r[index[c]] ?? "").trim() : "");
  const rows = data.slice(1).map((r, i): ImportRow => ({
    row: i + 1, name: cell(r, "name"), email: cell(r, "email").toLowerCase(), branch: cell(r, "branch"), team: cell(r, "team"),
    manager: cell(r, "reporting_manager"), role: cell(r, "role"), applications: cell(r, "applications"), designation: cell(r, "designation"),
  }));
  return { rows, ignoredColumns };
}

/** The template an administrator downloads: notes first (lines starting with # are ignored), then the header, then a commented example. */
export const TEMPLATE_CSV = `${[
  ["# MCCIA App Hub: add many people at once. Lines that start with # are notes and are ignored."],
  ["# Required: name and email. Everything else is optional: a value that is not found is left empty and the person is still added."],
  ["# Do NOT add a password column: each person gets a temporary password by email and chooses their own."],
  ["# branch and team: used only if they already exist (see Branches & Teams); otherwise left empty."],
  ["# reporting_manager: that person's email, if they already have an account or appear in this file; otherwise left empty."],
  ["# role: leave empty for User, or write Team manager. Other roles (Super Admin, HR Admin, Expense Admin, Admin) are given on the profile."],
  ["# applications: names separated by commas. Write Category / App if the same name exists in two application categories."],
  ["# example: Asha Patil | asha.patil@example.com | Pune | Accounts | manager@example.com | | Tally, CRM | Accountant"],
  [...COLUMNS],
]
  .map((r) => toCsv([r]))
  .join("\r\n")}\r\n`;

/** One row as the person-friendly column names, for the corrected file or the results report. */
export const rowToCells = (r: ImportRow) => [r.name, r.email, r.branch, r.team, r.manager, r.role, r.applications, r.designation];
