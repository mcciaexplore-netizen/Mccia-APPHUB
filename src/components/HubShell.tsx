"use client";

import { Suspense, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar, type SidebarDept, type SidebarUser } from "@/components/Sidebar";
import { UserMenu } from "@/components/UserMenu";

export function HubShell({
  user, departments, signOutAction, children,
}: {
  user: SidebarUser | null; departments: SidebarDept[]; signOutAction: () => Promise<void>; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const sidebar = (
    <Suspense fallback={<div className="h-full w-48 bg-primary-2" />}>
      <Sidebar user={user} departments={departments} onNavigate={close} onClose={close} />
    </Suspense>
  );

  return (
    <div className="flex min-h-screen bg-canvas">
      <div className="sticky top-0 hidden h-screen lg:block">{sidebar}</div>

      {open && <div className="fixed inset-0 z-40 bg-overlay lg:hidden" onClick={close} aria-hidden />}
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}>
        {sidebar}
      </div>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 lg:justify-end border-b border-line bg-white px-4 shadow-card sm:px-6">
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="text-muted transition-colors hover:text-primary lg:hidden"><Menu size={22} /></button>
          {user ? (
            <UserMenu name={user.name} role={user.role} signOutAction={signOutAction} />
          ) : null}
        </header>
        <main className="bg-canvas p-1.5 sm:p-2.5">
          <div className="min-h-[calc(100vh-4rem-1.25rem)] rounded-sm bg-white p-4 shadow-card sm:p-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
