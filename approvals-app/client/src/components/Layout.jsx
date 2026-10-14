import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useApp } from "../App.jsx";
import { api } from "../api.js";

const EXP = "expenditure,dg_expenditure";
const NAV = {
  employee: [
    ["My Expenses", `/list?view=mine&modules=${EXP}`],
    ["My HR Requests", "/list?view=mine&modules=hr"],
    ["My Reimbursements", "/list?view=mine&modules=reimbursement"],
    ["My Events", "/list?view=mine&modules=event"],
  ],
  shrotri: [
    ["Pending Expenditures", `/list?view=pending&modules=${EXP}`, ["expenditure", "dg_expenditure"]],
    ["Pending Reimbursements", "/list?view=pending&modules=reimbursement", ["reimbursement"]],
    ["Pending Events", "/list?view=pending&modules=event", ["event"]],
    ["Approved", "/list?view=approved"],
    ["Rejected", "/list?view=rejected"],
  ],
  satavisha: [
    ["Pending HR Requests", "/list?view=pending&modules=hr", ["hr"]],
    ["Approved HR", "/list?view=approved&modules=hr"],
    ["Rejected HR", "/list?view=rejected&modules=hr"],
  ],
  dg: [
    ["All Pending (escalated)", "/list?view=pending", ["expenditure", "dg_expenditure", "hr", "reimbursement", "event"]],
    ["Full History", "/list?view=history"],
  ],
};

export default function Layout({ children }) {
  const { user, signOut } = useApp();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({ pending: {}, info: 0 });
  const loc = useLocation();
  const here = loc.pathname + loc.search;

  useEffect(() => {
    let live = true;
    const load = () => api("GET", "/api/counts").then((c) => live && setCounts(c)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { live = false; clearInterval(t); };
  }, [here]);

  const items = [...(NAV[user.username] ?? NAV[user.role] ?? [])];
  if (user.can_manage) items.push(["Budgets", "/budgets"], ["Masters", "/masters"]);

  const nav = (
    <nav className="flex-1 overflow-y-auto py-2" aria-label="Main">
      <Link to="/" onClick={() => setOpen(false)} className={`block px-5 py-2.5 text-sm ${loc.pathname === "/" ? "bg-brand font-bold text-white" : "text-gray-300 hover:bg-white/10"}`}>Home</Link>
      {items.map(([label, to, modules]) => {
        const n = modules ? modules.reduce((s, m) => s + (counts.pending[m] ?? 0), 0) : 0;
        const active = here === to || (to === "/budgets" || to === "/masters" ? loc.pathname === to : false);
        return (
          <Link key={to} to={to} onClick={() => setOpen(false)} className={`flex items-center justify-between px-5 py-2.5 text-sm ${active ? "bg-brand font-bold text-white" : "text-gray-300 hover:bg-white/10"}`}>
            <span>{label}</span>
            {n > 0 && <span className="rounded-full bg-yellow-400 px-2 text-xs font-bold text-gray-900">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const side = (
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-side text-white transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:shrink-0 lg:translate-x-0 lg:visible ${open ? "translate-x-0" : "invisible -translate-x-full"}`}>
      <div className="border-b border-white/10 bg-side-2 px-5 py-4 text-center">
        <div className="text-lg font-black tracking-wide">MCCIA</div>
        <div className="text-xs uppercase tracking-widest text-gray-400">Approvals</div>
      </div>
      {nav}
      <div className="flex items-center gap-3 border-t border-white/10 bg-side-2 px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-sm font-bold">{user.name[0]}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{user.name}</div>
          <div className="text-xs capitalize text-gray-400">{user.role === "dg" ? "Director General" : user.role}</div>
        </div>
        <button onClick={signOut} className="text-xs text-gray-300 underline hover:text-white">Sign out</button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen">
      {side}
      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-white px-4 py-3 lg:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="text-2xl leading-none">☰</button>
          <span className="font-bold">MCCIA Approvals</span>
        </header>
        <main className="p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
