import { AppCard, type CardApp } from "@/components/AppCard";
import { APP_ENTRY } from "@/lib/approvals/approvals.manifest";

/** The two forms for raising a request, as cards at the top of the home page. They are for everyone who signs in: nothing has to be ticked. */
const FORMS: { app: CardApp; href: string }[] = [
  { app: { id: "approval-form-hr", name: "HR Approval Form", description: "Raise an HR request, for example a certificate or a letter.", icon: "UserCheck" }, href: APP_ENTRY.hr },
  { app: { id: "approval-form-expenditure", name: "Expenditure Approval Form", description: "Raise an expense. The form points you to the DG form for ₹10,000 and above.", icon: "Wallet" }, href: APP_ENTRY.exp },
];

export function ApprovalFormCards() {
  return (
    <section aria-labelledby="approval-forms-title" className="mb-10">
      <h2 id="approval-forms-title" className="mb-4 text-lg text-ink">Approval Forms</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-6">
        {FORMS.map((f, i) => <AppCard key={f.app.id} app={f.app} index={i} href={f.href} cta="Open form" />)}
      </div>
    </section>
  );
}
