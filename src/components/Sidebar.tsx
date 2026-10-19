"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Activity, Bell, ChevronDown, ClipboardCheck, ClipboardList, Inbox, LayoutDashboard, ShieldCheck, UserCheck, UsersRound, Users, Wallet, X } from "lucide-react";
import { lockAdmin } from "@/actions/auth";
import { Icon } from "@/components/Icon";
import type { Role } from "@/db/schema";
import { adminTabsFor } from "@/lib/admin-tabs";
import { canAdminister } from "@/lib/rbac";
import { REVIEW_LABEL, SETUP_GROUP_LABEL, approvalsApps, isGroup, reviewHref, type NavItem, type ReviewItem } from "@/lib/approvals/approvals.manifest";

export type SidebarDept = { id: string; name: string; icon: string };
export type SidebarUser = { name: string; role: Role; adminAreas?: readonly string[] };

/** One row of the sidebar: a line icon and a label; the page you are on is a soft teal pill. */
const ROW = "nav-item mx-3 my-0.5 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-200";
const rowTone = (active: boolean) => (active ? "bg-nav-active text-primary" : "text-ink hover:bg-alt");
/** The links that drop down under Approval System and Administrator. */
const SUB = "nav-item flex min-h-10 items-center gap-2 rounded-md px-3 text-[0.82rem] transition-colors duration-200";
const subTone = (active: boolean) => (active ? "bg-nav-active font-semibold text-primary" : "text-muted hover:bg-alt hover:text-ink");

function Item({ href, active, onNavigate, children }: { href: string; active: boolean; onNavigate: () => void; children: React.ReactNode }) {
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${ROW} ${rowTone(active)}`}>
      {children}
    </Link>
  );
}

/** The Support Admin's set-up screens (Who Approves What, Office Branches, ...), read from the Approval System menu data. */
const SETUP_LINKS: NavItem[] = approvalsApps.flatMap((a) => a.nav).flatMap((e) => (isGroup(e) && e.label === SETUP_GROUP_LABEL ? e.items : []));

const ADMIN_LINKS = [
  { href: "/administrator", label: "Dashboard", Icon: LayoutDashboard, exact: true },
  { href: "/administrator/users", label: "Users", Icon: Users },
  { href: "/administrator/approval-forms", label: "Approval Forms", Icon: ClipboardCheck },
  { href: "/administrator/notifications", label: "Notification Panel", Icon: Bell },
  { href: "/administrator/activity", label: "Activity Log", Icon: Activity },
] as const;

export function Sidebar({
  user, departments, showApprovals, review = [], showSetup = false, onNavigate, onClose,
}: {
  user: SidebarUser | null; departments: SidebarDept[]; showApprovals: boolean; /** Where this person works under Approval System (HR, Expenditure), with what waits for them. */ review?: readonly ReviewItem[]; /** The Support Admin: the set-up screens are listed under Approval System too. */ showSetup?: boolean; onNavigate: () => void; onClose: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const d = params.get("d");
  const inApprovals = pathname === "/approvals" || pathname.startsWith("/approvals/");
  const onReview = pathname.startsWith("/approvals/review/");
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
        {/* Approval System is a feature of the hub, not an application in a department. It opens its own page (the forms); once you are in it,
            the places you work in (HR, Expenditure) open under it, for people who approve requests. */}
        {showApprovals && (
          <div>
            <Item href="/approvals" active={inApprovals && !onReview} onNavigate={onNavigate}>
              <ClipboardList size={20} /> <span className="flex-1 py-2">Approval System</span>
              {(review.length > 0 || showSetup) && <ChevronDown size={16} aria-hidden className={`transition-transform duration-200 ${inApprovals ? "rotate-180" : ""}`} />}
            </Item>
            {inApprovals && (review.length > 0 || showSetup) && (
              <div className="ml-8 mr-3 mt-0.5 space-y-0.5 border-l border-line pl-2" aria-label="Approval System">
                {review.map((r) => {
                  const active = pathname.startsWith(`/approvals/review/${r.key}/`);
                  return (
                    <Link key={r.key} href={reviewHref(r.key)} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${SUB} ${subTone(active)}`}>
                      {r.key === "hr" ? <UserCheck size={15} className="shrink-0" /> : r.key === "expenditure" ? <Wallet size={15} className="shrink-0" /> : <Inbox size={15} className="shrink-0" />}
                      <span className="flex-1 whitespace-nowrap py-2">{REVIEW_LABEL[r.key]}</span>
                      {r.waiting > 0 && <span className="rounded-pill bg-brand-red px-1.5 text-[0.68rem] font-bold leading-5 text-white">{r.waiting > 99 ? "99+" : r.waiting}</span>}
                    </Link>
                  );
                })}
                {showSetup && (
                  <div className="mt-3 space-y-0.5 border-t border-line pt-3" aria-label={SETUP_GROUP_LABEL}>
                    <p className="px-3 pb-1 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">{SETUP_GROUP_LABEL}</p>
                    {SETUP_LINKS.map((l) => {
                      const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
                      return (
                        <Link key={l.href} href={l.href!} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${SUB} ${subTone(active)}`}>
                          <span className="flex-1 whitespace-nowrap py-2">{l.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
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
        {user && canAdminister(user) && (
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
                {ADMIN_LINKS.flatMap((l) => { const t = adminTabsFor(user).find((x) => x.label === l.label); return t ? [{ ...l, to: t.href }] : []; }).map(({ href, to, label, Icon: LinkIcon, ...rest }) => {
                  const active = "exact" in rest ? pathname === href : pathname.startsWith(href) || (href === "/administrator/users" && pathname.startsWith("/administrator/access"));
                  return (
                    <Link key={href} href={to} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`${SUB} ${subTone(active)}`}>
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
