"use client";

import { Suspense, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar, type SidebarDept, type SidebarUser } from "@/components/Sidebar";
import { UserMenu } from "@/components/UserMenu";

export function HubShell({
  user, departments, showApprovals, children,
}: {
  user: SidebarUser | null; departments: SidebarDept[]; showApprovals: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const sidebar = (
    <Suspense fallback={<div className="h-full w-60 border-r border-line bg-white" />}>
      <Sidebar user={user} departments={departments} showApprovals={showApprovals} onNavigate={close} onClose={close} />
    </Suspense>
  );

  return (
    <div className="flex min-h-screen bg-canvas">
      <div className="sticky top-0 hidden h-screen lg:block">{sidebar}</div>

      {open && <div className="fixed inset-0 z-40 bg-overlay lg:hidden" onClick={close} aria-hidden />}
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 lg:hidden ${open ? "translate-x-0 shadow-card-hover" : "-translate-x-full"}`}>
        {sidebar}
      </div>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 bg-white px-4 sm:px-8 lg:justify-end">
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="text-muted transition-colors hover:text-primary lg:hidden"><Menu size={22} /></button>
          {user ? (
            <UserMenu name={user.name} role={user.role} />
          ) : null}
        </header>
        <main className="p-4 pt-2 sm:p-8 sm:pt-4">{children}</main>
      </div>
    </div>
  );
}
