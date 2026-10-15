"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Activity, Bell, Building2, ChevronDown, ChevronRight, ClipboardList, ShieldCheck, Users, Wallet, UserCheck, X } from "lucide-react";
import { lockAdmin } from "@/actions/auth";
import { Icon } from "@/components/Icon";
import { APP_ENTRY, appOwning, approvalsApps, parseApp, type AppKey } from "@/lib/approvals/approvals.manifest";

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

/** The two applications under Approval System, in the order they are listed. */
const APPROVAL_APPS: { key: AppKey; Icon: typeof Wallet }[] = [{ key: "hr", Icon: UserCheck }, { key: "exp", Icon: Wallet }];

const ADMIN_LINKS = [
  { href: "/administrator/departments", label: "Departments", Icon: Building2 },
  { href: "/administrator/users", label: "Users", Icon: Users },
  { href: "/administrator/notifications", label: "Notifications Panel", Icon: Bell },
] as const;

export function Sidebar({
  user, departments, showApprovals, onNavigate, onClose,
}: {
  user: SidebarUser | null; departments: SidebarDept[]; showApprovals: boolean; onNavigate: () => void; onClose: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const d = params.get("d");
  // Approval System opens with two applications under it; the one you are in is marked (a request page says which with ?app=).
  const inApprovals = pathname === "/approvals" || pathname.startsWith("/approvals/");
  const [approvalsOpen, setApprovalsOpen] = useState(inApprovals);
  const approvalsId = useId();
  const currentApp = inApprovals ? appOwning(pathname) ?? parseApp(params.get("app")) : null;
  const onHome = pathname === "/";
  const inAdmin = pathname.startsWith("/administrator");
  const [adminOpen, setAdminOpen] = useState(inAdmin);
  // Administrator locks itself the moment you leave it (the proxy only re-checks on the way in).
  const wasInAdmin = useRef(inAdmin);
  useEffect(() => {
    if (wasInAdmin.current && !inAdmin) void lockAdmin();
    wasInAdmin.current = inAdmin;
  }, [inAdmin]);
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
        {/* Approval System is a feature of the hub, not an application in a department: a dropdown whose two entries open the applications. */}
        {showApprovals && (
          <div>
            <button
              type="button"
              onClick={() => setApprovalsOpen((o) => !o)}
              aria-expanded={approvalsOpen || inApprovals}
              aria-controls={approvalsId}
              className={`flex min-h-14 w-full items-center gap-3 border-b border-white/15 px-4 text-left text-sm font-medium transition-colors duration-200 ${
                inApprovals ? "bg-primary text-brand-green" : "text-white hover:bg-white/10"
              }`}
            >
              <ClipboardList size={20} /> <span className="flex-1 py-2">Approval System</span>
              <ChevronDown size={16} className={`transition-transform duration-200 ${approvalsOpen || inApprovals ? "rotate-180" : ""}`} />
            </button>
            {(approvalsOpen || inApprovals) && (
              <div id={approvalsId} className="bg-black/15">
                {APPROVAL_APPS.map(({ key, Icon: AppIcon }) => {
                  const active = currentApp === key;
                  const title = approvalsApps.find((a) => a.key === key)!.title;
                  return (
                    <Link
                      key={key}
                      href={APP_ENTRY[key]}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-12 items-center gap-2 border-b border-white/10 pl-6 pr-2 text-[0.8rem] transition-colors duration-200 ${
                        active ? "font-semibold text-brand-green" : "text-white/85 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <AppIcon size={15} className="shrink-0" /> <span className="flex-1 whitespace-nowrap py-2">{title}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
