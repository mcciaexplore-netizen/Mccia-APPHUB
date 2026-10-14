import { useState } from "react";
import { useLocation } from "react-router-dom";
import { navFor } from "../../constants/nav.js";
import { useApp } from "../../context/AppContext.jsx";
import { useCounts } from "../../hooks/useCounts.js";
import ErrorBoundary from "../common/ErrorBoundary.jsx";
import Sidebar from "./Sidebar.jsx";

/** The frame around every signed-in page: the sidebar, a top bar on phones, and the page itself. */
export default function Layout({ children }) {
  const { user, signOut } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const here = loc.pathname + loc.search;
  const counts = useCounts(here, 30000);

  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} items={navFor(user)} counts={counts} here={here} pathname={loc.pathname} open={open} onNavigate={() => setOpen(false)} onSignOut={signOut} />
      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-white px-4 py-3 lg:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="text-2xl leading-none">☰</button>
          <span className="font-bold">MCCIA Approvals</span>
        </header>
        <main className="p-4 sm:p-8"><ErrorBoundary resetKey={here}>{children}</ErrorBoundary></main>
      </div>
    </div>
  );
}
