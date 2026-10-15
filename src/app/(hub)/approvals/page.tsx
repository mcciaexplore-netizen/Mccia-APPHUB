import { redirect } from "next/navigation";
import { requirePage } from "@/lib/approvals/guard";
import { hasAnyRole } from "@/lib/approvals/host-adapter";
import { waitingCount } from "@/lib/approvals/request-queries";

/**
 * Opening Approval System in the hub drops you straight into the application, like opening one of the Zoho apps: no landing page.
 * That is the Expenses form, unless you are an approver with something waiting for you, who lands on their inbox.
 */
export default async function Page() {
  const user = await requirePage();
  if (hasAnyRole(user, ["approver", "dg"]) && (await waitingCount(user)) > 0) redirect("/approvals/inbox");
  redirect("/approvals/expenses/new");
}
