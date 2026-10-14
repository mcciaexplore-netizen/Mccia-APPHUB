import Link from "next/link";
import { CheckCircle2, Circle, FileText, Landmark, Wallet } from "lucide-react";
import { OverBudgetBadge, StatusBadge } from "@/components/approvals/Badges";
import { PageHeader } from "@/components/approvals/PageHeader";
import { requirePage } from "@/lib/approvals/guard";
import { formatDate, formatINR } from "@/lib/approvals/format";
import { hasAnyRole, hasRole } from "@/lib/approvals/host-adapter";
import { listRequests, waitingCount } from "@/lib/approvals/request-queries";
import { getSettings } from "@/lib/approvals/settings";
import { setupChecklist } from "@/lib/approvals/setup";

const ROLE_LABEL = { requester: "Requester", approver: "Approver", dg: "Director General", viewer: "Viewer", approvals_admin: "Approvals admin" } as const;

export default async function Page() {
  const user = await requirePage();
  const [settings, checklist, waiting, mine] = await Promise.all([
    getSettings(),
    hasRole(user, "approvals_admin") ? setupChecklist() : Promise.resolve(null),
    hasAnyRole(user, ["approver", "dg"]) ? waitingCount(user) : Promise.resolve(0),
    listRequests(user, { mine: true, pageSize: 5 }),
  ]);
  const limit = formatINR(settings.thresholdPaise, { symbol: true }).replace(/\.00$/, "");

  const actions = [
    { href: "/approvals/hr/new", title: "HR", note: "Certificates, letters, circulars and more", Icon: FileText },
    { href: "/approvals/expenditures/new", title: "Expenditure", note: `${limit} and above, approved by the DG`, Icon: Landmark },
    { href: "/approvals/expenses/new", title: "Expenses", note: `Below ${limit}`, Icon: Wallet },
  ];

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} intro="Raise a request, follow it to a decision, and keep a full record of who approved what." />
      <div className="mb-6 flex flex-wrap gap-2">
        {user.roles.map((r) => <span key={r} className="badge">{ROLE_LABEL[r]}</span>)}
      </div>

      {waiting > 0 && (
        <Link href="/approvals/inbox" className="apr-notice mb-8 flex max-w-2xl items-center justify-between gap-3 hover:brightness-95">
          <span><b>{waiting}</b> {waiting === 1 ? "request is" : "requests are"} waiting for your decision.</span>
          <span className="apr-link">Open the inbox</span>
        </Link>
      )}

      <h2 className="mb-3">Raise a request</h2>
      <div className="mb-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map(({ href, title, note, Icon }) => (
          <Link key={href} href={href} className="glass glass-hover group flex items-center gap-4 p-5">
            <span className="icon-tile"><Icon size={20} /></span>
            <span className="min-w-0"><span className="block font-bold">{title}</span><span className="block text-sm text-[var(--z-muted)]">{note}</span></span>
          </Link>
        ))}
      </div>

      <h2 className="mb-3">Your recent requests</h2>
      {mine.rows.length === 0 ? (
        <p className="mb-10 text-[var(--z-muted)]">You have not raised a request yet.</p>
      ) : (
        <div className="table-wrap mb-10 max-w-3xl">
          <table>
            <thead><tr><th>Request No.</th><th>Category</th><th className="text-right">Amount (₹)</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              {mine.rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-bold"><Link className="text-[var(--z-teal-dark)] hover:underline" href={`/approvals/requests/${r.id}`}>{r.requestNo}</Link></td>
                  <td>{r.categoryName}</td>
                  <td className="text-right">{r.amountPaise == null ? "" : formatINR(r.amountPaise)}</td>
                  <td className="whitespace-nowrap">{formatDate(r.requestedAt)}</td>
                  <td><span className="inline-flex flex-wrap gap-1"><StatusBadge status={r.status} />{r.overBudget && <OverBudgetBadge />}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {checklist && (
        <>
          <h2 className="mb-3">Setup</h2>
          <ul className="max-w-2xl divide-y divide-[var(--z-line)] rounded-sm border border-[var(--z-line)]">
            {checklist.map((c) => (
              <li key={c.label}>
                <Link href={c.href} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-[#f7f8f9]">
                  {c.done ? <CheckCircle2 size={18} className="shrink-0 text-[var(--z-green)]" /> : <Circle size={18} className="shrink-0 text-[#aaa]" />}
                  <span className="font-bold">{c.label}</span>
                  <span className="ml-auto text-right text-xs text-[var(--z-muted)]">{c.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
