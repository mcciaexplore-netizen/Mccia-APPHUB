import Link from "next/link";
import { CalendarCheck, CheckSquare, Clock, Gift, Home, Network, Settings, UserRound, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/attendance/ui";
import { requireMember } from "@/lib/attendance/dal";
import { pendingCountFor } from "@/lib/attendance/approvals";
import { listMembers } from "@/lib/attendance/host-adapter";
import { MORE_LINKS } from "@/lib/attendance/att.manifest";

export const metadata = { title: "More · Attendance" };

const ICON: Record<(typeof MORE_LINKS)[number]["icon"], { icon: LucideIcon; tone: string }> = {
  summary: { icon: CalendarCheck, tone: "att-icon-green" },
  approvals: { icon: CheckSquare, tone: "att-icon-orange" },
  regularization: { icon: Clock, tone: "att-icon-blue" },
  wfh: { icon: Home, tone: "att-icon-green" },
  compoff: { icon: Gift, tone: "att-icon-purple" },
  org: { icon: Network, tone: "att-icon-blue" },
  profile: { icon: UserRound, tone: "att-icon-grey" },
  admin: { icon: Settings, tone: "att-icon-green" },
};

/** More: a grid of everything else (2 per row on a phone): the summary, requests, the org chart, the profile; Team approvals for managers; Attendance Admin for HR. */
export default async function MorePage() {
  const user = await requireMember();
  const [waiting, members] = await Promise.all([pendingCountFor(user.id), listMembers()]);
  const manages = waiting > 0 || members.some((m) => m.managerId === user.id);
  return (
    <>
      <PageHeader title="More" />
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {MORE_LINKS.filter((l) => (!("managerOnly" in l) || manages) && (!("adminOnly" in l) || user.admin)).map((l) => {
          const { icon: I, tone } = ICON[l.icon];
          return (
            <li key={l.href}>
              <Link href={l.href} className="att-card relative flex h-full min-h-[7.5rem] flex-col gap-3 p-4 transition-colors hover:bg-[var(--att-primary-tint)] sm:p-5">
                <span className={`att-icon ${tone}`} aria-hidden>
                  <I size={20} />
                </span>
                <span>
                  <span className="block text-[0.95rem] font-bold leading-snug text-(--att-text)">{l.label}</span>
                  <span className="mt-0.5 hidden text-xs text-gray-500 sm:block">{l.note}</span>
                </span>
                {l.href.endsWith("/approvals") && waiting > 0 && (
                  <span className="absolute right-3 top-3 rounded-full bg-[var(--att-amber)] px-2 py-0.5 text-xs font-bold text-white">{waiting}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
