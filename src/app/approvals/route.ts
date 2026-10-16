import { NextResponse, type NextRequest } from "next/server";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { hasAnyRole, resolveAccess } from "@/lib/approvals/host-adapter";
import { waitingCount } from "@/lib/approvals/request-queries";

export const dynamic = "force-dynamic";

/**
 * Opening Approval System drops you straight into the application: there is no landing page. A real redirect (not a page that redirects),
 * so it happens before anything is drawn. It goes to the Expenses form, unless you are an approver with something waiting for you, who
 * goes to their inbox. (The hub's sidebar sends people to HR Approval or Expenditure directly; this is for the bare /approvals address.)
 */
export async function GET(req: NextRequest) {
  if (!approvalsEnabled()) return new NextResponse("Not found", { status: 404 });
  const access = await resolveAccess();
  if (access.status === "anonymous") return NextResponse.redirect(new URL("/login?next=%2Fapprovals", req.url));
  const { user } = access;
  const waiting = hasAnyRole(user, ["approver", "dg"]) && (await waitingCount(user)) > 0;
  const target = waiting ? (hasAnyRole(user, ["dg"]) ? "/approvals/inbox" : "/approvals/my/pending") : "/approvals/expenses/new";
  return NextResponse.redirect(new URL(target, req.url));
}
