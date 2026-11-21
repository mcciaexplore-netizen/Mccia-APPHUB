import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/attendance/ui";
import { requireMember } from "@/lib/attendance/dal";
import { pendingCountFor } from "@/lib/attendance/approvals";
import { listMembers } from "@/lib/attendance/host-adapter";
import { MORE_LINKS } from "@/lib/attendance/att.manifest";

export const metadata = { title: "More · Attendance" };

/** More: the attendance summary, requests, profile and org chart (Team approvals for anyone who has people reporting to them). */
export default async function MorePage() {
  const user = await requireMember();
  const [waiting, members] = await Promise.all([pendingCountFor(user.id), listMembers()]);
  const manages = waiting > 0 || members.some((m) => m.managerId === user.id);
  return (
    <>
      <PageHeader title="More" />
      <ul className="att-card divide-y divide-[var(--att-line)] overflow-hidden">
        {MORE_LINKS.filter((l) => !("managerOnly" in l) || manages).map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex items-center gap-3 px-5 py-4 hover:bg-[var(--att-blue-tint)]">
              <span className="flex-1">
                <span className="block text-[0.95rem] font-bold text-ink">{l.label}</span>
                <span className="block text-xs att-muted">{l.note}</span>
              </span>
              {l.href.endsWith("/approvals") && waiting > 0 && <span className="rounded-full bg-[var(--att-amber)] px-2 py-0.5 text-xs font-bold text-white">{waiting}</span>}
              <ChevronRight size={18} className="att-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
