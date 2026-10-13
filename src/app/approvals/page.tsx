import Link from "next/link";
import { CheckCircle2, Circle, FileText, Landmark, Wallet } from "lucide-react";
import { PageHeader } from "@/components/approvals/PageHeader";
import { requirePage } from "@/lib/approvals/guard";
import { formatINR } from "@/lib/approvals/format";
import { hasRole } from "@/lib/approvals/host-adapter";
import { getSettings } from "@/lib/approvals/settings";
import { setupChecklist } from "@/lib/approvals/setup";

const ROLE_LABEL = { requester: "Requester", approver: "Approver", dg: "Director General", viewer: "Viewer", approvals_admin: "Approvals admin" } as const;

export default async function Page() {
  const user = await requirePage();
  const [settings, checklist] = await Promise.all([getSettings(), hasRole(user, "approvals_admin") ? setupChecklist() : Promise.resolve(null)]);
  const limit = formatINR(settings.thresholdPaise);

  const actions = [
    { href: "/approvals/expenses/new", title: "Expenses", note: `Expenditure below ${limit}`, Icon: Wallet },
    { href: "/approvals/expenditures/new", title: "Expenditure", note: `${limit} and above, approved by the DG`, Icon: Landmark },
    { href: "/approvals/hr/new", title: "HR", note: "Certificates, letters, circulars and more", Icon: FileText },
  ];

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} intro="Raise a request, follow it to a decision, and keep a full record of who approved what." />
      <div className="mb-8 flex flex-wrap gap-2">
        {user.roles.map((r) => <span key={r} className="badge">{ROLE_LABEL[r]}</span>)}
      </div>

      <h2 className="mb-3 text-lg">Raise a request</h2>
      <div className="mb-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map(({ href, title, note, Icon }) => (
          <Link key={href} href={href} className="glass glass-hover group flex items-center gap-4 !rounded-md p-5">
            <span className="icon-tile"><Icon size={20} /></span>
            <span className="min-w-0"><span className="block font-heading font-bold">{title}</span><span className="block text-sm text-muted">{note}</span></span>
          </Link>
        ))}
      </div>

      {checklist && (
        <>
          <h2 className="mb-3 text-lg">Setup</h2>
          <ul className="max-w-2xl divide-y divide-line rounded-md border border-line">
            {checklist.map((c) => (
              <li key={c.label}>
                <Link href={c.href} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-blue-tint">
                  {c.done ? <CheckCircle2 size={18} className="shrink-0 text-brand-green-text" /> : <Circle size={18} className="shrink-0 text-subtle" />}
                  <span className="font-medium">{c.label}</span>
                  <span className="ml-auto text-right text-xs text-muted">{c.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
