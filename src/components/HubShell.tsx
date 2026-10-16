"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { Bell, Menu } from "lucide-react";
import { SafetyMascot } from "@/components/SafetyMascot";
import { Sidebar, type SidebarDept, type SidebarUser } from "@/components/Sidebar";
import type { AppKey } from "@/lib/approvals/approvals.manifest";
import { UserMenu } from "@/components/UserMenu";

export function HubShell({
  user, departments, approvalApps, unread, children,
}: {
  user: SidebarUser | null; departments: SidebarDept[]; /** The Approval System applications this person may open; the item is not shown when there are none. */ approvalApps: readonly AppKey[]; /** Unread notifications; the bell is shown when this is given. */ unread?: number; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const sidebar = (
    <Suspense fallback={<div className="h-full w-60 border-r border-line bg-white" />}>
      <Sidebar user={user} departments={departments} approvalApps={approvalApps} onNavigate={close} onClose={close} />
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
            <div className="flex items-center gap-3">
              {unread !== undefined && (
                <Link href="/notifications" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} className="relative grid h-10 w-10 place-items-center rounded-md text-muted transition-colors hover:bg-alt hover:text-primary">
                  <Bell size={20} />
                  {unread > 0 && <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-brand-red px-1 text-[0.62rem] font-bold leading-none text-white">{unread > 99 ? "99+" : unread}</span>}
                </Link>
              )}
              <UserMenu name={user.name} role={user.role} />
            </div>
          ) : null}
        </header>
        <main className="p-4 pt-2 sm:p-8 sm:pt-4">{children}</main>
      </div>
      <SafetyMascot />
    </div>
  );
}
