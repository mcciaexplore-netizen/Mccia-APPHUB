"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, KeyRound, LogOut, UserRound } from "lucide-react";
import { logout } from "@/actions/auth";
import { roleLabel } from "@/lib/format";

export function UserMenu({ name, role }: { name: string; role: keyof typeof roleLabel }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-2 text-sm font-medium text-ink transition-colors hover:text-primary">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full border border-line text-ink"><UserRound size={18} /></span>
        <span className="max-w-28 truncate sm:max-w-40">{name}</span><ChevronDown size={14} className="text-subtle" />
      </button>
      {open && (
        <div role="menu" className="glass absolute right-0 top-full z-50 mt-3 w-52 animate-pop !rounded-md !bg-white p-2">
          <p className="px-3 pb-2 pt-1"><span className="badge">{roleLabel[role]}</span></p>
          <Link href="/change-password" className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-muted transition-colors hover:bg-blue-tint hover:text-primary"><KeyRound size={15} /> Change password</Link>
          <form action={logout}>
            <button className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-muted transition-colors hover:bg-blue-tint hover:text-primary"><LogOut size={15} /> Sign out</button>
          </form>
        </div>
      )}
    </div>
  );
}
