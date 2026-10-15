import { PageHeader } from "@/components/approvals/PageHeader";
import { RulesManager } from "@/components/approvals/RulesManager";
import { requirePage } from "@/lib/approvals/guard";
import { listUsers } from "@/lib/approvals/host-adapter";
import { listRules } from "@/lib/approvals/rules";
import { getSettings } from "@/lib/approvals/settings";

export const metadata = { title: "Approver Rules · MCCIA Approvals" };

export default async function Page() {
  await requirePage("approvals_admin");
  const [rules, people, settings] = await Promise.all([listRules(), listUsers(), getSettings()]);
  return (
    <>
      <PageHeader title="Approver Rules" intro="Who approves HR requests and expenditure. Whoever is named here becomes an approver (or the DG, on a later step) in the module." />
      <RulesManager rules={rules} people={people.map((u) => ({ id: u.id, name: u.name, email: u.email }))} thresholdPaise={settings.thresholdPaise} />
    </>
  );
}
