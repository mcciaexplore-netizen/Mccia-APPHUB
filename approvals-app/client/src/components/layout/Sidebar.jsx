import { Link } from "react-router-dom";
import { ROUTES } from "../../constants/routes.js";

/** The dark navigation on the left: the person's own menu, a count of what waits for them, and who they are. A drawer on phones. */
export default function Sidebar({ user, items, counts, here, pathname, open, onNavigate, onSignOut }) {
  const link = (active) => `flex items-center justify-between px-5 py-2.5 text-sm ${active ? "bg-brand font-bold text-white" : "text-gray-300 hover:bg-white/10"}`;
  return (
    <aside className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-side text-white transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:shrink-0 lg:translate-x-0 lg:visible ${open ? "translate-x-0" : "invisible -translate-x-full"}`}>
      <div className="border-b border-white/10 bg-side-2 px-5 py-4 text-center">
        <div className="text-lg font-black tracking-wide">MCCIA</div>
        <div className="text-xs uppercase tracking-widest text-gray-400">Approvals</div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2" aria-label="Main">
        <Link to={ROUTES.home} onClick={onNavigate} className={link(pathname === ROUTES.home)}>Home</Link>
        {items.map(([label, to, modules]) => {
          const waiting = modules ? modules.reduce((sum, m) => sum + (counts.pending[m] ?? 0), 0) : 0;
          const active = here === to || ((to === ROUTES.budgets || to === ROUTES.masters) && pathname === to);
          return (
            <Link key={to} to={to} onClick={onNavigate} className={link(active)}>
              <span>{label}</span>
              {waiting > 0 && <span className="rounded-full bg-yellow-400 px-2 text-xs font-bold text-gray-900">{waiting}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-3 border-t border-white/10 bg-side-2 px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-sm font-bold">{user.name[0]}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{user.name}</div>
          <div className="text-xs capitalize text-gray-400">{user.role === "dg" ? "Director General" : user.role}</div>
        </div>
        <button onClick={onSignOut} className="text-xs text-gray-300 underline hover:text-white">Sign out</button>
      </div>
    </aside>
  );
}
