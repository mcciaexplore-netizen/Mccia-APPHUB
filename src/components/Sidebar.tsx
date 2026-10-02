"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { Activity, Bell, Building2, ChevronDown, ChevronRight, ShieldCheck, Users, X } from "lucide-react";
import { Icon } from "@/components/Icon";

export type SidebarDept = { id: string; name: string; icon: string };
export type SidebarUser = { name: string; role: "head_admin" | "dept_lead" | "member" };

function Item({ href, active, onNavigate, children }: { href: string; active: boolean; onNavigate: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-14 items-center gap-3 border-b border-white/15 px-4 text-sm font-medium transition-colors duration-200 ${
        active ? "bg-primary text-brand-green" : "text-white hover:bg-white/10"
      }`}
    >
      {children}
    </Link>
  );
}

const ADMIN_LINKS = [
  { href: "/administrator/departments", label: "Departments", Icon: Building2 },
  { href: "/administrator/users", label: "Users", Icon: Users },
  { href: "/administrator/notifications", label: "Notifications Panel", Icon: Bell },
] as const;

export function Sidebar({
  user, departments, onNavigate, onClose,
}: {
  user: SidebarUser | null; departments: SidebarDept[]; onNavigate: () => void; onClose: () => void;
}) {
  const pathname = usePathname();
  const d = useSearchParams().get("d");
  const onHome = pathname === "/";
  const inAdmin = pathname.startsWith("/administrator");
  const [adminOpen, setAdminOpen] = useState(inAdmin);
  const submenuId = useId(); // the sidebar is rendered twice (desktop and mobile), so ids must be unique
  const selected = d && departments.some((x) => x.id === d) ? d : departments[0]?.id;

  return (
    <aside className="flex h-full w-48 flex-col bg-[image:var(--grad-side)] text-white">
      <div className="flex h-16 items-center justify-between gap-2 bg-white px-4">
        <Link href="/" onClick={onNavigate} className="block leading-tight">
          <span className="block font-heading text-xl font-extrabold tracking-tight text-primary">MCCIA</span>
          <span className="block text-[0.62rem] font-bold uppercase tracking-widest text-subtle">App Hub</span>
        </Link>
        <button className="text-ink lg:hidden" aria-label="Close menu" onClick={onClose}><X size={20} /></button>
      </div>

      <nav className="flex-1 overflow-y-auto" aria-label="Departments">
        {departments.length === 0 && <p className="px-4 py-3 text-xs text-white/70">No departments yet</p>}
        {departments.map((dep) => {
          const active = onHome && selected === dep.id;
          return (
            <Item key={dep.id} href={`/?d=${dep.id}`} active={active} onNavigate={onNavigate}>
              <Icon name={dep.icon} size={20} />
              <span className="flex-1 py-2">{dep.name}</span>
              {active && <ChevronRight size={16} />}
            </Item>
          );
        })}
        {user?.role === "dept_lead" && (
          <Item href="/activity" active={pathname === "/activity"} onNavigate={onNavigate}>
            <Activity size={20} /> <span className="flex-1 py-2">Activity</span>
            {pathname === "/activity" && <ChevronRight size={16} />}
          </Item>
        )}
        {user?.role === "head_admin" && (
          <div>
            <button
              type="button"
              onClick={() => setAdminOpen((o) => !o)}
              aria-expanded={adminOpen || inAdmin}
              aria-controls={submenuId}
              className={`flex min-h-14 w-full items-center gap-3 border-b border-white/15 px-4 text-left text-sm font-medium transition-colors duration-200 ${
                inAdmin ? "bg-primary text-brand-green" : "text-white hover:bg-white/10"
              }`}
            >
              <ShieldCheck size={20} /> <span className="flex-1 py-2">Administrator</span>
              <ChevronDown size={16} className={`transition-transform duration-200 ${adminOpen || inAdmin ? "rotate-180" : ""}`} />
            </button>
            {(adminOpen || inAdmin) && (
              <div id={submenuId} className="bg-black/15">
                {ADMIN_LINKS.map(({ href, label, Icon: LinkIcon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-12 items-center gap-2 border-b border-white/10 pl-6 pr-2 text-[0.8rem] transition-colors duration-200 ${
                        active ? "font-semibold text-brand-green" : "text-white/85 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <LinkIcon size={15} className="shrink-0" /> <span className="flex-1 whitespace-nowrap py-2">{label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </nav>

    </aside>
  );
}
