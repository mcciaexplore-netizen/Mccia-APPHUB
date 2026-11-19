import { notFound, redirect } from "next/navigation";
import { BudgetForm } from "@/components/approvals/BudgetForm";
import { PageHeader } from "@/components/approvals/PageHeader";
import { budgetRevisionProps } from "@/lib/approvals/form-data";
import { requirePage } from "@/lib/approvals/guard";
import { getRequestDetail } from "@/lib/approvals/request-queries";
import { idSchema } from "@/lib/approvals/validation";

export const metadata = { title: "Revise Budget · MCCIA Approvals" };

/**
 * Asking for a revision of a budget, at any stage. Only the person who raised it may; anyone else goes back to the request's page. The form
 * starts from the latest version still standing. The server checks all of it again on submit.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const asked = await getRequestDetail(id, user);
  if (!asked?.budget) notFound();
  if (!asked.budget.canRevise) redirect(`/approvals/requests/${id}?app=hr`);
  const baseId = asked.budget.baseId;
  const base = !baseId || baseId === asked.id ? asked : await getRequestDetail(baseId, user);
  if (!base?.budget) redirect(`/approvals/requests/${id}?app=hr`);
  return (
    <>
      <PageHeader intro="Change the budget at any stage. Every version already sent is kept, and the revision needs its own approval." />
      <BudgetForm {...await budgetRevisionProps(user, asked, base)} />
    </>
  );
}
