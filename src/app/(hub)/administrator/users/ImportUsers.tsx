"use client";

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { useToast } from "@/components/Toast";
import { parseCsv, toCsv } from "@/lib/csv";
import { importUsers, type ImportResult } from "@/actions/users";

type Row = { line: number; name: string; email: string; password: string; department: string; applications: string; designation: string };

const BATCH = 20; // a big file is sent a few rows at a time
const MAX_ROWS = 1000;
const TEMPLATE = toCsv([
  ["name", "email", "password", "department", "applications", "designation"],
  ["Full Name", "name@example.com", "Choose-a-password-1", "Department name", "App name, Other app name", "Job title"],
]);

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function ImportUsers() {
  const toast = useToast();
  const [file, setFile] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);

  async function pick(f: File | undefined) {
    setResults([]); setRows([]); setProblem(null); setDone(0);
    if (!f) return;
    setFile(f.name);
    if (f.size > 1_000_000) return setProblem("That file is over 1 MB. Split it into smaller files.");
    const table = parseCsv(await f.text());
    if (table.length < 2) return setProblem("The file needs a header row and at least one user.");
    const head = table[0].map((h) => h.trim().toLowerCase());
    const col = (n: string) => head.indexOf(n);
    if (col("email") < 0 || col("name") < 0 || col("password") < 0) return setProblem('The first row must contain the columns "name", "email" and "password".');
    if (table.length - 1 > MAX_ROWS) return setProblem(`At most ${MAX_ROWS} users per file.`);
    const cell = (r: string[], n: string) => (col(n) >= 0 ? (r[col(n)] ?? "").trim() : "");
    const appsCol = col("applications") >= 0 ? "applications" : "apps";
    setRows(table.slice(1).map((r, i) => ({
      line: i + 2, name: cell(r, "name"), email: cell(r, "email"), password: cell(r, "password"), department: cell(r, "department"),
      applications: cell(r, appsCol), designation: cell(r, "designation"),
    })));
  }

  async function run() {
    setRunning(true); setResults([]); setDone(0);
    const all: ImportResult[] = [];
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const r = await importUsers(batch);
      if (r.ok) all.push(...r.data);
      else all.push(...batch.map((b) => ({ line: b.line, email: b.email, name: b.name, status: "error" as const, message: r.error })));
      setResults([...all]); setDone(Math.min(i + BATCH, rows.length));
    }
    setRunning(false);
    const made = all.filter((x) => x.status === "created").length;
    toast.success(`${made} user${made === 1 ? "" : "s"} created.`);
  }

  const created = results.filter((r) => r.status === "created");

  return (
    <div className="glass space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">Import users from CSV</h2>
        <p className="mt-1 text-sm text-muted">
          Set up many accounts at once. Columns: <b>name</b>, <b>email</b> (the username) and <b>password</b> (required, at least 10 characters with a letter and a number), plus
          optional <b>department</b>, <b>applications</b> and <b>designation</b>. Several applications go in one quoted cell separated by commas, for example
          <code>&quot;Tally, CRM&quot;</code>. Each is looked up in the user&apos;s own department first; write <code>Department / App</code> if the same name exists in
          more than one. Departments and applications must already exist, and emails that already exist are skipped. From Excel, use File, Save As, CSV.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn btn-primary btn-sm cursor-pointer"><Upload size={14} /> Choose CSV file
          <input type="file" accept=".csv,text/csv" className="sr-only" disabled={running} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => download("users-template.csv", TEMPLATE)}><Download size={14} /> Download template</button>
        {file && <span className="text-sm text-muted">{file}</span>}
      </div>

      {problem && <div role="alert" className="alert alert-red">{problem}</div>}

      {rows.length > 0 && results.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm"><b>{rows.length}</b> user{rows.length === 1 ? "" : "s"} ready to import.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Line</th><th>Name</th><th>Email</th><th>Department</th><th>Applications</th></tr></thead>
            <tbody>{rows.slice(0, 5).map((r) => <tr key={r.line}><td>{r.line}</td><td>{r.name}</td><td>{r.email}</td><td>{r.department || <span className="text-subtle">none</span>}</td><td>{r.applications || <span className="text-subtle">none</span>}</td></tr>)}
              {rows.length > 5 && <tr><td colSpan={5} className="text-subtle">…and {rows.length - 5} more</td></tr>}</tbody>
          </table></div>
          <button className="btn btn-primary btn-sm" disabled={running} onClick={run}>Import {rows.length} user{rows.length === 1 ? "" : "s"}</button>
        </div>
      )}

      {(running || results.length > 0) && (
        <div className="space-y-3">
          <p className="text-sm">{running ? `Importing… ${done} of ${rows.length}` : `Finished: ${created.length} created, ${results.filter((r) => r.status === "skipped").length} skipped, ${results.filter((r) => r.status === "error").length} with errors.`}</p>
          <div className="table-wrap max-h-96 overflow-y-auto"><table>
            <thead><tr><th>Line</th><th>Email</th><th>Result</th></tr></thead>
            <tbody>{results.map((r) => (
              <tr key={`${r.line}-${r.email}`}><td>{r.line}</td><td>{r.email || <span className="text-subtle">(blank)</span>}</td>
                <td><span className={`badge ${r.status === "created" ? "badge-green" : r.status === "error" ? "badge-red" : "badge-neutral"}`}>{r.status}</span> <span className="text-xs text-muted">{r.message}</span></td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
