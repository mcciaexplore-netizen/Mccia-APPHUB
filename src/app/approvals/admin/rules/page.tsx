import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { PageHeader } from "@/components/approvals/PageHeader";
import { RulesManager } from "@/components/approvals/RulesManager";
import { requirePage } from "@/lib/approvals/guard";
import { listUsers } from "@/lib/approvals/host-adapter";
import { listRules } from "@/lib/approvals/rules";
import { getSettings } from "@/lib/approvals/settings";
import { setupChecklist } from "@/lib/approvals/setup";

export const metadata = { title: "Approver Rules · MCCIA Approvals" };

export default async function Page() {
  await requirePage("approvals_admin");
  const [rules, people, settings, checklist] = await Promise.all([listRules(), listUsers(), getSettings(), setupChecklist()]);
  return (
    <>
      <PageHeader title="Approver Rules" intro="Who approves HR requests and expenditure. Whoever is named here becomes an approver (or the DG, on a later step) in the module." />
      <RulesManager rules={rules} people={people.map((u) => ({ id: u.id, name: u.name, email: u.email }))} thresholdPaise={settings.thresholdPaise} />
      <details className="mt-10 max-w-2xl">
        <summary className="cursor-pointer text-lg font-bold">Setup checklist</summary>
        <p className="mb-3 mt-2 text-sm text-[var(--z-muted)]">What still has to be filled in before staff can use the forms. Click a line to go and do it.</p>
        <ul className="divide-y divide-[var(--z-line)] rounded-sm border border-[var(--z-line)]">
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
      </details>
    </>
  );
}
