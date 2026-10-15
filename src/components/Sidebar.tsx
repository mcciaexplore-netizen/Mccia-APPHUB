"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Activity, AppWindow, Bell, Building2, ChevronDown, ClipboardList, LayoutDashboard, ShieldCheck, UsersRound, Users, Wallet, UserCheck, X } from "lucide-react";
import { lockAdmin } from "@/actions/auth";
import { Icon } from "@/components/Icon";
import { APP_ENTRY, appOwning, approvalsApps, parseApp, type AppKey } from "@/lib/approvals/approvals.manifest";

export type SidebarDept = { id: string; name: string; icon: string };
export type SidebarUser = { name: string; role: "head_admin" | "dept_lead" | "member" };

/** One row of the sidebar: a line icon and a label; the page you are on is a soft teal pill. */
const ROW = "mx-3 my-0.5 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-200";
const rowTone = (active: boolean) => (active ? "bg-nav-active text-primary" : "text-ink hover:bg-alt");
/** The links that drop down under Approval System and Administrator. */
const SUB = "flex min-h-10 items-center gap-2 rounded-md px-3 text-[0.82rem] transition-colors duration-200";
const subTone = (active: boolean) => (active ? "bg-nav-active font-semibold text-primary" : "text-muted hover:bg-alt hover:text-ink");

function Item({ href, active, onNavigate, children }: { href: string; active: boolean; onNavigate: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${ROW} ${rowTone(active)}`}>
      {children}
    </Link>
  );
}

/** The two applications under Approval System, in the order they are listed. */
const APPROVAL_APPS: { key: AppKey; Icon: typeof Wallet }[] = [{ key: "hr", Icon: UserCheck }, { key: "exp", Icon: Wallet }];

const ADMIN_LINKS = [
  { href: "/administrator", label: "Dashboard", Icon: LayoutDashboard, exact: true },
  { href: "/administrator/departments", label: "Departments", Icon: Building2 },
  { href: "/administrator/users", label: "Users & Access", Icon: Users },
  { href: "/administrator/inventory", label: "Applications", Icon: AppWindow },
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
    <aside className="flex h-full w-60 flex-col border-r border-line bg-white text-ink">
      <div className="flex h-16 items-center justify-between gap-2 px-6">
        <Link href="/" onClick={onNavigate} className="block leading-tight">
          <span className="block text-xl font-extrabold tracking-tight text-ink">MCCIA</span>
          <span className="block text-[0.62rem] font-bold uppercase tracking-widest text-primary">App Hub</span>
        </Link>
        <button className="text-ink lg:hidden" aria-label="Close menu" onClick={onClose}><X size={20} /></button>
      </div>

      <nav className="flex-1 overflow-y-auto pb-6 pt-3" aria-label="Departments">
        {departments.length === 0 && <p className="px-6 py-3 text-xs text-subtle">No departments yet</p>}
        {departments.map((dep) => (
          <Item key={dep.id} href={`/?d=${dep.id}`} active={onHome && selected === dep.id} onNavigate={onNavigate}>
            <Icon name={dep.icon} size={20} />
            <span className="flex-1 py-2">{dep.name}</span>
          </Item>
        ))}
        {/* Approval System is a feature of the hub, not an application in a department: a dropdown whose two entries open the applications. */}
        {showApprovals && (
          <div>
            <button
              type="button"
              onClick={() => setApprovalsOpen((o) => !o)}
              aria-expanded={approvalsOpen || inApprovals}
              aria-controls={approvalsId}
              className={`${ROW} w-[calc(100%-1.5rem)] text-left ${rowTone(inApprovals)}`}
            >
              <ClipboardList size={20} /> <span className="flex-1 py-2">Approval System</span>
              <ChevronDown size={16} className={`transition-transform duration-200 ${approvalsOpen || inApprovals ? "rotate-180" : ""}`} />
            </button>
            {(approvalsOpen || inApprovals) && (
              <div id={approvalsId} className="ml-8 mr-3 mt-0.5 space-y-0.5 border-l border-line pl-2">
                {APPROVAL_APPS.map(({ key, Icon: AppIcon }) => {
                  const active = currentApp === key;
                  const title = approvalsApps.find((a) => a.key === key)!.title;
                  return (
                    <Link key={key} href={APP_ENTRY[key]} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${SUB} ${subTone(active)}`}>
                      <AppIcon size={15} className="shrink-0" /> <span className="flex-1 whitespace-nowrap py-2">{title}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {user?.role === "dept_lead" && (
          <>
            <Item href="/team" active={pathname === "/team" || pathname.startsWith("/team/")} onNavigate={onNavigate}>
              <UsersRound size={20} /> <span className="flex-1 py-2">My team</span>
            </Item>
            <Item href="/activity" active={pathname === "/activity"} onNavigate={onNavigate}>
              <Activity size={20} /> <span className="flex-1 py-2">Activity</span>
            </Item>
          </>
        )}
        {user?.role === "head_admin" && (
          <div>
            <button
              type="button"
              onClick={() => setAdminOpen((o) => !o)}
              aria-expanded={adminOpen || inAdmin}
              aria-controls={submenuId}
              className={`${ROW} w-[calc(100%-1.5rem)] text-left ${rowTone(inAdmin)}`}
            >
              <ShieldCheck size={20} /> <span className="flex-1 py-2">Administrator</span>
              <ChevronDown size={16} className={`transition-transform duration-200 ${adminOpen || inAdmin ? "rotate-180" : ""}`} />
            </button>
            {(adminOpen || inAdmin) && (
              <div id={submenuId} className="ml-8 mr-3 mt-0.5 space-y-0.5 border-l border-line pl-2">
                {ADMIN_LINKS.map(({ href, label, Icon: LinkIcon, ...rest }) => {
                  const active = "exact" in rest ? pathname === href : pathname.startsWith(href) || (href === "/administrator/users" && pathname.startsWith("/administrator/access"));
                  return (
                    <Link key={href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${SUB} ${subTone(active)}`}>
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
