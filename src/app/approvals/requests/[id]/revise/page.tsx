import { notFound, redirect } from "next/navigation";
import { BudgetForm } from "@/components/approvals/BudgetForm";
import { PageHeader } from "@/components/approvals/PageHeader";
import { budgetRevisionProps } from "@/lib/approvals/form-data";
import { requirePage } from "@/lib/approvals/guard";
import { getRequestDetail } from "@/lib/approvals/request-queries";
import { idSchema } from "@/lib/approvals/validation";

export const metadata = { title: "Revise Budget · MCCIA Approvals" };

/**
 * Asking for a revision of an approved budget. Only the person who raised it may, while no other revision waits; anyone else, or a budget
 * that cannot be revised now, goes back to the request's page (which says why). The server checks all of it again on submit.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const asked = await getRequestDetail(id, user);
  if (!asked?.budget) notFound();
  if (!asked.budget.canRevise) redirect(`/approvals/requests/${id}?app=hr`);
  const active = asked.budget.activeId === asked.id ? asked : asked.budget.activeId ? await getRequestDetail(asked.budget.activeId, user) : null;
  if (!active?.budget) redirect(`/approvals/requests/${id}?app=hr`);
  return (
    <>
      <PageHeader intro="Ask for a new budget amount when the approved one is exceeded. The revision needs a fresh approval." />
      <BudgetForm {...await budgetRevisionProps(user, asked, active)} />
    </>
  );
}
