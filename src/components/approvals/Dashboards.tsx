import Link from "next/link";
import { CheckCircle2, Receipt, UserPlus } from "lucide-react";
import { ApprovalFormCards } from "@/components/ApprovalFormCards";
import { EmptyState, StatusPill } from "@/components/approvals/shared-ui";
import { appForType, reviewHref } from "@/lib/approvals/approvals.manifest";
import { approvalsOverview } from "@/lib/approvals/admin-overview";
import { TYPE_LABEL } from "@/lib/approvals/calc";
import { formatDate, formatINR } from "@/lib/approvals/format";
import type { ApprovalsUser } from "@/lib/approvals/host-adapter";
import { getRequestDetail, listRequests, reviewItemsFor, waitingCount, type RequestRow } from "@/lib/approvals/request-queries";
import { listRules } from "@/lib/approvals/rules";
import { getSettings } from "@/lib/approvals/settings";

/**
 * What each kind of person sees on the Approval System page. The page picks one (see app/approvals/page.tsx); everything shown here comes
 * from the module's existing queries, so a person only ever sees the requests they may open.
 */

const requestHref = (r: Pick<RequestRow, "id" | "type">) => `/approvals/requests/${r.id}?app=${appForType(r.type)}`;
const money = (paise: number | null) => (paise == null ? "—" : formatINR(paise, { symbol: true }));
/** The Director General's wording for the three kinds of request. */
const DG_TYPE = { hr: "HR Request", expenditure_large: "High-Value Expenditure", expenditure_small: "Expense" } as const;

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-10" aria-label={title}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The two forms, kept at the bottom of every dashboard but the staff one (which is made of them), so anyone can still raise a request. */
function RaiseARequest() {
  return <div className="mt-12"><ApprovalFormCards /></div>;
}

/* ---------------------------------------------------------------- staff */

export async function StaffDashboard({ user }: { user: ApprovalsUser }) {
  const { rows } = await listRequests(user, { mine: true, pageSize: 10 });
  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2">
        <article className="card-lift glass !rounded-md flex flex-col p-6">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-md bg-blue-tint text-primary"><UserPlus size={24} aria-hidden /></span>
          <h2 className="text-xl text-ink">HR Request</h2>
          <p className="mt-1 flex-1 text-sm text-subtle">Raise a request for hiring, transfer, or any HR action</p>
          <Link href="/approvals/hr/new" className="btn btn-primary mt-5 self-start">Submit HR Request</Link>
        </article>
        <article className="card-lift glass !rounded-md flex flex-col p-6">
          <span className="mb-4 grid h-12 w-12 place-items-center rounded-md bg-blue-tint text-primary"><Receipt size={24} aria-hidden /></span>
          <h2 className="text-xl text-ink">Expense Request</h2>
          <p className="mt-1 flex-1 text-sm text-subtle">Submit an expense of any amount. Below ₹10,000 it is approved directly; ₹10,000 and above goes on to the DG.</p>
          <Link href="/approvals/expenses/new" className="btn btn-primary mt-5 self-start">Submit Expense</Link>
        </article>
      </div>

      <Section title="My Recent Submissions">
        {rows.length === 0 ? <EmptyState kind="mine" /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Request No.</th><th>Type</th><th>Submitted</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap font-bold"><Link href={requestHref(r)} className="text-[var(--z-accent)] hover:underline">{r.requestNo ?? "Request"}</Link></td>
                    <td>{TYPE_LABEL[r.type]}</td>
                    <td className="whitespace-nowrap">{formatDate(r.requestedAt)}</td>
                    <td><StatusPill status={r.status} currentStepNo={r.currentStep} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- approver (HR or Expenditure) */

export async function ApproverDashboard({ user }: { user: ApprovalsUser }) {
  const [waiting, { rows }, places] = await Promise.all([
    waitingCount(user),
    listRequests(user, { waitingForMe: true, statuses: ["pending"], pageSize: 5 }),
    reviewItemsFor(user),
  ]);
  // Which kind of request this person reviews follows the Approver Rules that name them.
  const allHref = places.some((p) => p.key === "hr") ? "/approvals/hr/all" : "/approvals/expenditures/all";
  return (
    <>
      {waiting > 0 ? (
        <p className="banner-in apr-banner apr-banner-amber" role="status">
          <span>You have <b>{waiting}</b> {waiting === 1 ? "request" : "requests"} waiting for your review</span>
          <Link href="/approvals/my/pending">Review all →</Link>
        </p>
      ) : (
        <p className="banner-in apr-banner apr-banner-green" role="status"><CheckCircle2 size={18} aria-hidden /> You are all caught up. Nothing needs your attention right now.</p>
      )}

      {rows.length > 0 && (
        <Section title="Waiting for Your Review" action={waiting > 5 ? <Link href="/approvals/my/pending" className="apr-link text-sm">View all {waiting} waiting →</Link> : undefined}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <article key={r.id} className="glass !rounded-md flex flex-col gap-1.5 p-5">
                <div className="flex items-start justify-between gap-2"><b className="text-ink">{r.requestNo ?? "Request"}</b><StatusPill status={r.status} currentStepNo={r.currentStep} /></div>
                <p className="text-sm text-ink">{r.name}</p>
                <p className="text-sm text-subtle">{r.categoryName ?? "—"}</p>
                <p className="text-lg font-bold text-ink">{money(r.amountPaise)}</p>
                <p className="text-xs text-subtle">Submitted {formatDate(r.requestedAt)}</p>
                <Link href={requestHref(r)} className="btn btn-primary btn-sm mt-2 self-start">Review</Link>
              </article>
            ))}
          </div>
        </Section>
      )}

      <Section title="Quick Links">
        <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link href="/approvals/my/pending" className="apr-link">All my pending</Link>
          <Link href="/approvals/my/completed" className="apr-link">Completed by me</Link>
          <Link href={allHref} className="apr-link">All requests</Link>
        </p>
      </Section>
      <RaiseARequest />
    </>
  );
}

/* ---------------------------------------------------------------- Director General */

export async function DgDashboard({ user }: { user: ApprovalsUser }) {
  const [waiting, { rows }, decided] = await Promise.all([
    waitingCount(user),
    listRequests(user, { waitingForMe: true, statuses: ["pending"], pageSize: 5 }),
    listRequests(user, { decidedByMe: true, statuses: ["approved", "rejected"], sort: "decidedAt", pageSize: 5 }),
  ]);
  // Who recommended each one, and when it reached the DG: the step before theirs, from the request's own history.
  const details = await Promise.all(rows.map((r) => getRequestDetail(r.id, user)));
  const queue = reviewHref("recommendation");
  return (
    <>
      {waiting > 0 ? (
        <p className="banner-in apr-banner apr-banner-purple" role="status">
          <span>Recommended Queue — <b>{waiting}</b> {waiting === 1 ? "item" : "items"} awaiting your final decision</span>
          <Link href={queue}>Review all →</Link>
        </p>
      ) : (
        <p className="banner-in apr-banner apr-banner-green" role="status"><CheckCircle2 size={18} aria-hidden /> Nothing is waiting for your final decision.</p>
      )}

      {rows.length > 0 && (
        <Section title="Awaiting Your Final Decision" action={waiting > 5 ? <Link href={queue} className="apr-link text-sm">View all →</Link> : undefined}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r, i) => {
              const before = details[i]?.steps.filter((s) => s.stepNo < r.currentStep && s.status === "approved").at(-1);
              return (
                <article key={r.id} className="glass !rounded-md flex flex-col gap-1.5 p-5">
                  <div className="flex items-start justify-between gap-2"><b className="text-ink">{r.requestNo ?? "Request"}</b><span className="text-xs text-subtle">{DG_TYPE[r.type]}</span></div>
                  <p className="text-sm text-ink">{r.name}</p>
                  <p className="text-2xl font-bold text-ink">{money(r.amountPaise)}</p>
                  {before && <p className="text-xs text-subtle">Recommended by {before.approverName}</p>}
                  <p className="text-xs text-subtle">Reached you {formatDate(before?.decidedAt ?? r.requestedAt)}</p>
                  {r.overBudget && <p className="apr-strip">⚠️ Exceeds available budget</p>}
                  <Link href={requestHref(r)} className="btn btn-primary btn-sm mt-2 self-start">Review &amp; Decide</Link>
                </article>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Recent Decisions">
        {decided.rows.length === 0 ? <p className="text-sm text-subtle">You have not decided anything yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Request No.</th><th>Type</th><th>Outcome</th><th>Date decided</th></tr></thead>
              <tbody>
                {decided.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap font-bold"><Link href={requestHref(r)} className="text-[var(--z-accent)] hover:underline">{r.requestNo ?? "Request"}</Link></td>
                    <td>{DG_TYPE[r.type]}</td>
                    <td><StatusPill status={r.status} /></td>
                    <td className="whitespace-nowrap">{formatDate(r.decidedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <RaiseARequest />
    </>
  );
}

/* ---------------------------------------------------------------- viewer */

export async function ViewerDashboard() {
  const { hr } = await approvalsOverview();
  const stats = [
    { label: "All Requests", n: hr.total, href: "/approvals/hr/all" },
    { label: "Pending", n: hr.pending, href: "/approvals/hr/pending" },
    { label: "Approved", n: hr.approved, href: "/approvals/hr/approved" },
    { label: "Rejected", n: hr.rejected, href: "/approvals/hr/rejected" },
  ];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card-lift glass glass-hover !rounded-md block p-5 text-center">
            <span className="big-number">{s.n}</span>
            <p className="label-xs mt-2">{s.label}</p>
            <p className="mt-0.5 text-xs text-subtle">HR requests</p>
          </Link>
        ))}
      </div>
      <p className="mt-6 flex flex-wrap gap-3">
        <Link href="/approvals/hr/all" className="btn btn-ghost">View HR Requests</Link>
        <Link href="/approvals/expenditures/all" className="btn btn-ghost">View Expenditure Requests</Link>
      </p>
      <RaiseARequest />
    </>
  );
}

/* ---------------------------------------------------------------- Support Admin */

export async function SupportAdminDashboard({ user }: { user: ApprovalsUser }) {
  const [rules, settings, pending] = await Promise.all([listRules(), getSettings(), listRequests(user, { statuses: ["pending"], pageSize: 10 })]);
  // Who is named where requests are actually routed: the Approver Rules (filled from the HR, Expenditure and Super Admin accounts until changed).
  const named = (type: "hr" | "expenditure_large" | "expenditure_small", step: number) => rules.find((r) => r.active && r.requestType === type && r.stepNo === step)?.approverName ?? null;
  const people = [
    { label: "HR Approver", name: named("hr", 1) },
    { label: "Expense Approver", name: named("expenditure_small", 1) ?? named("expenditure_large", 1) },
    { label: "Director General", name: named("hr", 2) ?? named("expenditure_large", 2) },
  ];
  const incomplete = people.some((p) => !p.name);
  return (
    <>
      <Section title="System Status">
        {incomplete && (
          <Link href="/approvals/admin/rules" className="banner-in apr-banner apr-banner-red mb-4" role="alert">
            ⚠️ Setup incomplete — some requests cannot be routed. Go to Who Approves What to fix this.
          </Link>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {people.map((p) => (
            <Link key={p.label} href="/approvals/admin/rules" className="card-lift glass glass-hover !rounded-md block p-5">
              <p className="label-xs">{p.label}</p>
              <p className="mt-2 flex items-center gap-2 font-bold text-ink">
                <span className="apr-dot" style={{ background: p.name ? "#16a34a" : "#dc2626" }} aria-hidden />
                {p.name ?? "Not configured"}
              </p>
            </Link>
          ))}
          <Link href="/approvals/admin/settings" className="card-lift glass glass-hover !rounded-md block p-5">
            <p className="label-xs">Approval Threshold</p>
            <p className="mt-2 font-bold text-ink">{formatINR(settings.thresholdPaise, { symbol: true })}</p>
            <p className="mt-0.5 text-xs text-subtle">Expenditure of this amount and above goes to the DG</p>
          </Link>
        </div>
      </Section>

      <Section title="Requests Waiting Now" action={<Link href="/approvals/hr/pending" className="apr-link text-sm">View all pending →</Link>}>
        {pending.rows.length === 0 ? <p className="text-sm text-subtle">Nothing is waiting for a decision right now.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Request No.</th><th>Type</th><th>Requester</th><th>Amount</th><th>Submitted</th><th>Waiting for</th></tr></thead>
              <tbody>
                {pending.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap font-bold"><Link href={requestHref(r)} className="text-[var(--z-accent)] hover:underline">{r.requestNo ?? "Request"}</Link></td>
                    <td>{TYPE_LABEL[r.type]}</td>
                    <td>{r.name}</td>
                    <td className="whitespace-nowrap">{money(r.amountPaise)}</td>
                    <td className="whitespace-nowrap">{formatDate(r.requestedAt)}</td>
                    <td>{r.approverName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <RaiseARequest />
    </>
  );
}
