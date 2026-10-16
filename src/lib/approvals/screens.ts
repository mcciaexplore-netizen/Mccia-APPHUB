import type { AprRequestStatus, AprRequestType } from "@/db/approvals-schema";

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
  "expenses/pending": { title: "Pending", intro: "Expenses below ₹10,000 waiting for a decision.", types: SMALL, statuses: ["pending"], branch: true, vendor: true, categories: "expense" },
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
