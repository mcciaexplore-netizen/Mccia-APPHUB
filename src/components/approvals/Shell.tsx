"use client";

import { Suspense, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/approvals/Sidebar";
import { approvalsManifest, type ApprovalsRole } from "@/lib/approvals/approvals.manifest";

/** The module's own full-screen layout: a dark sidebar like the Zoho apps, and a white page beside it. */
export function Shell({
  user, signOut, children,
}: {
  user: { name: string; roles: ApprovalsRole[] };
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const sidebar = (
    <Suspense fallback={<div className="h-full w-64 bg-(--apr-side)" />}>
      <Sidebar user={user} signOut={signOut} onNavigate={close} onClose={close} />
    </Suspense>
  );

  return (
    <div className="apr-root flex min-h-screen bg-canvas">
      <div className="sticky top-0 hidden h-screen lg:block">{sidebar}</div>

      {open && <div className="fixed inset-0 z-40 bg-overlay lg:hidden" onClick={close} aria-hidden />}
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}>{sidebar}</div>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-white px-4 shadow-card lg:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="text-muted transition-colors hover:text-primary"><Menu size={22} /></button>
          <span className="font-heading text-lg font-extrabold text-primary">{approvalsManifest.name}</span>
        </header>
        <main className="p-1.5 sm:p-2.5">
          <div className="min-h-[calc(100vh-1.25rem)] rounded-sm bg-white p-4 shadow-card sm:p-6 lg:min-h-[calc(100vh-1.25rem)]">{children}</div>
        </main>
      </div>
    </div>
  );
}
