import { BudgetForm } from "@/components/approvals/BudgetForm";
import { PageHeader } from "@/components/approvals/PageHeader";
import { budgetFormProps } from "@/lib/approvals/form-data";
import { requirePage } from "@/lib/approvals/guard";

export const metadata = { title: "Budget Approval · MCCIA Approvals" };

/**
 * The Budget Approval form, for an event's budget: open to everyone who can open the Approval System, like the HR and Expenditure forms. It
 * goes to the one approver the requester picks; once approved, the requester can ask for a revision from the request's page.
 */
export default async function Page() {
  const user = await requirePage();
  return (
    <>
      <PageHeader title="Budget Approval" intro="An event's budget, sent to the approver you choose. Total income, total expense and the surplus or deficit are worked out as you type." />
      <BudgetForm {...await budgetFormProps(user)} />
    </>
  );
}
