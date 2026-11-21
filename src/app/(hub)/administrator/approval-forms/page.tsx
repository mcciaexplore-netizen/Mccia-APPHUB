import Link from "next/link";
import { notFound } from "next/navigation";
import { Banknote, UserCheck, Wallet } from "lucide-react";
import { WatchersPanel } from "@/components/approvals/WatchersPanel";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { listUsers } from "@/lib/approvals/host-adapter";
import { listWatchers } from "@/lib/approvals/watchers";
import { requireHeadAdmin } from "@/lib/permissions";
import type { AprWatcherForm } from "@/db/approvals-schema";

export const metadata = { title: "Approval Forms · MCCIA App Hub" };

const FORMS = [
  { form: "hr", label: "HR", href: "/administrator/approval-forms/hr", title: "HR form", text: "The form staff fill in to raise an HR request: its fields, their names and order, and your own extra fields.", Icon: UserCheck },
  { form: "expenditure", label: "Expenditure", href: "/administrator/approval-forms/expenditure", title: "Expenditure form", text: "The one expense form, with the same fields for every amount. From ₹10,000 it also goes to the Super Admin.", Icon: Wallet },
  { form: "budget", label: "Budget", href: "/administrator/approval-forms/budget", title: "Budget form", text: "The budget approval form for events, with income, expenses and revision tracking.", Icon: Banknote },
] as const satisfies readonly { form: AprWatcherForm; label: string; href: string; title: string; text: string; Icon: unknown }[];

/**
 * Approval Forms: the forms staff use to raise a request, each opening its editor (also HR, Expenditure and Budget in the sidebar), and each
 * with its Watchers: hub users who read every request of the form and are told of new ones, without deciding anything.
 */
export default async function Page() {
  await requireHeadAdmin();
  if (!approvalsEnabled()) notFound();
  const [watchers, people] = await Promise.all([listWatchers(), listUsers()]);
  const options = people.map((p) => ({ id: p.id, name: p.name, email: p.email })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="space-y-5">
      <div><h2 className="text-xl">Approval Forms</h2><p className="mt-1 text-sm text-muted">Choose a form to change what it asks. A saved change shows the next time someone opens the form. The Watchers of a form can read all its requests.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FORMS.map((f) => (
          <div key={f.href} className="glass !rounded-md flex flex-col gap-2 p-5" data-testid={`form-card-${f.form}`}>
            <Link href={f.href} className="group flex flex-col gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-blue-tint text-primary"><f.Icon size={20} /></span>
              <span className="text-lg font-semibold text-ink">{f.title}</span>
              <span className="text-sm text-muted">{f.text}</span>
              <span className="mt-1 text-sm font-semibold text-primary group-hover:underline">Edit form →</span>
            </Link>
            <WatchersPanel
              form={f.form} label={f.label} people={options}
              watchers={watchers.filter((w) => w.formType === f.form).map((w) => ({ id: w.id, userId: w.userId, name: w.name, email: w.email, active: w.active }))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
