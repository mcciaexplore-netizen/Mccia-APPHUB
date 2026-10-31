import { db } from "@/lib/ivr/db";
import { allocationRules } from "@/db/ivr-schema";
import { CategoriesManager, type CategoryDTO } from "@/components/ivr/admin/categories-manager";
import { PageHeader } from "@/components/ivr/ui";
import { listCategories } from "@/lib/ivr/categories";
import { requireAdmin } from "@/lib/ivr/dal";
import { listAgentUsers } from "@/lib/ivr/leads";
import { getRetryRule } from "@/lib/ivr/settings";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  await requireAdmin();
  const [cats, rules, agents, retry] = await Promise.all([
    listCategories(),
    db.select().from(allocationRules),
    listAgentUsers(),
    getRetryRule(),
  ]);
  const dto: CategoryDTO[] = cats.map((c) => ({
    id: c.id,
    label: c.label,
    appliesTo: c.appliesTo,
    ivrKey: c.ivrKey,
    active: c.active,
    agentIds: rules.filter((r) => r.categoryId === c.id).map((r) => r.userId),
  }));
  return (
    <div className="grid gap-5">
      <PageHeader title="Categories" subtitle="What calls are about, who handles each category, and how retries work." />
      <CategoriesManager categories={dto} agents={agents.map((a) => ({ id: a.id, name: a.name }))} retry={retry} />
    </div>
  );
}
