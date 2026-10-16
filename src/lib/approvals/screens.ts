import type { AprRequestStatus, AprRequestType } from "@/db/approvals-schema";
import { parseReviewPath, type ReviewKey, type ReviewTab } from "./approvals.manifest";

/**
 * The list screens in the sidebar, as data. Each one is the same table with a different starting filter, so one component renders
 * them all. The key is the address after /approvals/. What a person actually sees is still decided by the server: a list can only
 * ever hold requests they are allowed to open, whatever the filter says.
 */
export type ListScreen = {
  title: string;
  intro: string;
  types?: AprRequestType[];
  statuses?: AprRequestStatus[];
  /** Only requests this person raised. */
  mine?: boolean;
  /** Only requests currently waiting for this person. */
  waitingForMe?: boolean;
  /** Only requests this person has already decided. */
  decidedByMe?: boolean;
  /** Only requests this person recommended to a later approver (approved their step, and the request goes on). */
  recommendedByMe?: boolean;
  /** Only requests this person rejected. */
  rejectedByMe?: boolean;
  /** Only requests this person approved (at any step, whether or not they went on to a later one). */
  approvedByMe?: boolean;
  /** Show the Branch column (expenditure lists). */
  branch?: boolean;
  /** Show vendor and tax invoice date (the below-threshold approved list). */
  vendor?: boolean;
  /** Approve and Reject buttons on each row (the DG's inbox). */
  quickDecide?: boolean;
  /** Which category list the filter offers. */
  categories: "hr" | "expense" | "all";
  /** The form to open for a new request, shown as a button. */
  newHref?: string;
};

const HR: AprRequestType[] = ["hr"];
const LARGE: AprRequestType[] = ["expenditure_large"];
const SMALL: AprRequestType[] = ["expenditure_small"];

const LIST_SCREENS: Record<string, ListScreen> = {
  "hr/all": { title: "All Hr", intro: "Every HR request you are allowed to see.", types: HR, categories: "hr", newHref: "/approvals/hr/new" },
  "hr/approved": { title: "Approved HR requests", intro: "HR requests that were approved.", types: HR, statuses: ["approved"], categories: "hr" },
  "hr/pending": { title: "Pending HR Request", intro: "HR requests still waiting for a decision.", types: HR, statuses: ["pending"], categories: "hr" },
  "hr/rejected": { title: "Rejected HR Requests", intro: "HR requests that were rejected.", types: HR, statuses: ["rejected"], categories: "hr" },

  "expenditures/all": { title: "All Expenditures", intro: "Every expenditure request of ₹10,000 and above you are allowed to see.", types: LARGE, branch: true, categories: "expense", newHref: "/approvals/expenditures/new" },
  "expenditures/approved": { title: "Approved Expenditure Requests", intro: "Expenditure requests that were approved. Their amounts count against the budget.", types: LARGE, statuses: ["approved"], branch: true, categories: "expense" },
  "expenditures/pending": { title: "Pending Expenditure Requests", intro: "Expenditure requests still waiting for a decision.", types: LARGE, statuses: ["pending"], branch: true, categories: "expense" },
  "expenditures/rejected": { title: "Rejected Expenditure Requests", intro: "Expenditure requests that were rejected.", types: LARGE, statuses: ["rejected"], branch: true, categories: "expense" },

  "expenses/approved": { title: "Approved Expenses", intro: "Expenses below ₹10,000 that were approved.", types: SMALL, statuses: ["approved"], branch: true, vendor: true, categories: "expense" },
  "expenses/pending": { title: "Pending", intro: "Expenses below ₹10,000 waiting for your decision.", types: SMALL, statuses: ["pending"], waitingForMe: true, quickDecide: true, branch: true, vendor: true, categories: "expense" },
  "expenses/waiting": { title: "All Pending Expenses", intro: "All expenses below ₹10,000 still waiting for a decision.", types: SMALL, statuses: ["pending"], branch: true, vendor: true, categories: "expense" },
  "expenses/mine": { title: "My Requests", intro: "Expenses below ₹10,000 that you raised, with where each one stands.", types: SMALL, mine: true, branch: true, vendor: true, categories: "expense", newHref: "/approvals/expenses/new" },
  "expenses/rejected": { title: "Rejected Expenses", intro: "Expenses below ₹10,000 that were rejected.", types: SMALL, statuses: ["rejected"], branch: true, vendor: true, categories: "expense" },

  inbox: {
    title: "Recommended Queue", intro: "Everything recommended to you for the final decision, HR and Expenditure together, newest first. Open a request to see its details before deciding.",
    statuses: ["pending"], waitingForMe: true, branch: true, quickDecide: true, categories: "all",
  },
  "my/pending": { title: "Pending Approvals", intro: "Forms waiting for your decision.", statuses: ["pending"], waitingForMe: true, branch: true, quickDecide: true, categories: "all" },
  "my/recommended": { title: "Recommended", intro: "Forms you recommended to the Director General, and where each one stands now.", recommendedByMe: true, branch: true, categories: "all" },
  "my/rejected": { title: "Rejected Forms", intro: "Forms you rejected.", rejectedByMe: true, branch: true, categories: "all" },
  "my/completed": { title: "Completed by me", intro: "Requests you have already approved or rejected.", decidedByMe: true, branch: true, categories: "all" },
};

export const screenFor = (slug: string[]): ListScreen | undefined => LIST_SCREENS[slug.join("/")];

const REVIEW_TYPES: Record<ReviewKey, AprRequestType[]> = { hr: HR, expenditure: ["expenditure_large", "expenditure_small"] };

/**
 * The three lists of HR and of Expenditure that an approver works from (Pending, Approved, Rejected). For someone who decides requests they
 * are about the person's own work: what waits for them (with Approve and Reject on each row), what they approved and what they rejected.
 * For someone who only oversees, they are every request of that kind by its status.
 */
export function reviewScreen(key: ReviewKey, tab: ReviewTab, decides: boolean): ListScreen {
  const types = REVIEW_TYPES[key];
  const common = { types, branch: true, categories: key === "hr" ? ("hr" as const) : ("expense" as const) };
  if (tab === "pending") {
    return decides
      ? { ...common, title: "Pending", intro: "Waiting for your decision. Approve or Reject here, or open a request to see its files and budget first.", statuses: ["pending"], waitingForMe: true, quickDecide: true }
      : { ...common, title: "Pending", intro: "Still waiting for a decision.", statuses: ["pending"] };
  }
  if (tab === "approved") {
    return decides
      ? { ...common, title: "Approved", intro: "Requests you approved. One you recommended to the Director General shows where it stands now.", approvedByMe: true }
      : { ...common, title: "Approved", intro: "Requests that were approved.", statuses: ["approved"] };
  }
  return decides
    ? { ...common, title: "Rejected", intro: "Requests you rejected.", rejectedByMe: true }
    : { ...common, title: "Rejected", intro: "Requests that were rejected.", statuses: ["rejected"] };
}

/** The screen for a path, whichever kind it is: one of the fixed lists, or one of the Pending / Approved / Rejected lists of HR and Expenditure. */
export function resolveScreen(slug: string[], decides: boolean): ListScreen | undefined {
  const review = parseReviewPath(slug);
  return review ? reviewScreen(review.key, review.tab, decides) : screenFor(slug);
}
