import Link from "next/link";
import { notFound } from "next/navigation";
import { UserCheck, Wallet } from "lucide-react";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { requireHeadAdmin } from "@/lib/permissions";

export const metadata = { title: "Approval Forms · MCCIA App Hub" };

const FORMS = [
  { href: "/administrator/approval-forms/hr", title: "HR form", text: "The form staff fill in to raise an HR request: its fields, their names and order, and your own extra fields.", Icon: UserCheck },
  { href: "/administrator/approval-forms/expenditure", title: "Expenditure form", text: "The one expense form, with the fields asked below ₹10,000 and those asked from ₹10,000 up.", Icon: Wallet },
] as const;

/** Approval Forms: the two forms staff use to raise a request, each opening its editor (also HR and Expenditure in the sidebar). */
export default async function Page() {
  await requireHeadAdmin();
  if (!approvalsEnabled()) notFound();
  return (
    <div className="space-y-5">
      <div><h2 className="text-xl">Approval Forms</h2><p className="mt-1 text-sm text-muted">Choose a form to change what it asks. A saved change shows the next time someone opens the form.</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        {FORMS.map((f) => (
          <Link key={f.href} href={f.href} className="card-lift glass !rounded-md flex flex-col gap-2 p-5">
            <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-blue-tint text-primary"><f.Icon size={20} /></span>
            <span className="text-lg font-semibold text-ink">{f.title}</span>
            <span className="text-sm text-muted">{f.text}</span>
            <span className="mt-1 text-sm font-semibold text-primary">Edit form →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
