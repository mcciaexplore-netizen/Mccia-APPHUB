/**
 * What the Approvals module is, for the host: its name, icon, where it is mounted, who may open it and what its sidebar holds.
 * Pure data (no server code), so the client sidebar can import it too.
 *
 * Registering the module in the hub: Administrator > a department > Add application, with the name and icon below and the URL
 * https://<your-domain>/approvals (a plain /approvals path is accepted as well).
 */

export type ApprovalsRole = "requester" | "approver" | "dg" | "viewer" | "approvals_admin";
export const ALL_ROLES: readonly ApprovalsRole[] = ["requester", "approver", "dg", "viewer", "approvals_admin"];

export type NavItem = {
  label: string;
  href?: string;
  /** Visible to anyone holding at least one of these roles. Omitted means everyone. */
  roles?: readonly ApprovalsRole[];
  /** Build phase in which the real screen arrives; until then the route shows a placeholder. */
  phase?: number;
  /** Greyed out with a "Coming soon" tag. */
  disabled?: boolean;
};
export type NavGroup = { label: string; icon: string; items: NavItem[] };
export type NavEntry = NavGroup | (NavItem & { icon: string });

const REVIEW = ["approver", "dg", "viewer", "approvals_admin"] as const; // anyone who handles requests or oversees them
const OVERSIGHT = ["viewer", "approvals_admin"] as const; // sees everything, read only (admin can also edit)
const ADMIN = ["approvals_admin"] as const;

export const approvalsManifest = {
  name: "Approvals",
  description: "HR and expenditure approvals with a full audit trail.",
  icon: "ClipboardList", // from the host icon list (src/lib/icons.ts)
  basePath: "/approvals",
  apiBasePath: "/api/approvals",
  /** Every signed-in person with access to the app card is a requester. */
  requiredRoles: ["requester"] as readonly ApprovalsRole[],
  nav: [
    {
      label: "Expenses", icon: "Wallet",
      items: [
        { label: "Expenses", href: "/approvals/expenses/new", phase: 2 },
        { label: "Approved Expenses", href: "/approvals/expenses/approved", phase: 4 },
      ],
    },
    {
      label: "Approvals", icon: "UserCheck",
      items: [
        { label: "My Pending", href: "/approvals/my/pending", phase: 3 },
        { label: "My Approved", href: "/approvals/my/approved", phase: 3 },
        { label: "My Rejected", href: "/approvals/my/rejected", phase: 3 },
      ],
    },
    {
      label: "Hr", icon: "Briefcase",
      items: [
        { label: "HR", href: "/approvals/hr/new", phase: 2 },
        { label: "All Hr", href: "/approvals/hr/all", roles: OVERSIGHT, phase: 4 },
        { label: "HR Approval Categories", href: "/approvals/admin/hr-categories", roles: ADMIN },
        { label: "HR Approval Timeline", href: "/approvals/hr/timeline", roles: REVIEW, phase: 4 },
        { label: "Approval Timeline", href: "/approvals/timeline", roles: REVIEW, phase: 4 },
        { label: "HR Report", href: "/approvals/hr/report", roles: OVERSIGHT, phase: 4 },
        { label: "Approved HR requests", href: "/approvals/hr/approved", roles: REVIEW, phase: 4 },
        { label: "Pending HR Request", href: "/approvals/hr/pending", roles: REVIEW, phase: 4 },
        { label: "Rejected HR Requests", href: "/approvals/hr/rejected", roles: REVIEW, phase: 4 },
        { label: "Approval Time", href: "/approvals/hr/approval-time", roles: OVERSIGHT, phase: 4 },
      ],
    },
    {
      label: "Expenditures", icon: "Landmark",
      items: [
        { label: "Expenditure", href: "/approvals/expenditures/new", phase: 2 },
        { label: "All Expenditures", href: "/approvals/expenditures/all", roles: OVERSIGHT, phase: 4 },
        { label: "Approved Expenditure Requests", href: "/approvals/expenditures/approved", roles: REVIEW, phase: 4 },
        { label: "Pending Expenditure Requests", href: "/approvals/expenditures/pending", roles: REVIEW, phase: 4 },
        { label: "Rejected Expenditure Requests", href: "/approvals/expenditures/rejected", roles: REVIEW, phase: 4 },
        { label: "Expenditure Report", href: "/approvals/expenditures/report", roles: OVERSIGHT, phase: 4 },
      ],
    },
    {
      label: "All_Budgets", icon: "PieChart",
      items: [
        { label: "Budgets", href: "/approvals/budgets", roles: OVERSIGHT },
        { label: "Budget utilisation", href: "/approvals/budgets/utilisation", roles: OVERSIGHT, phase: 4 },
      ],
    },
    { label: "Event Approvals", icon: "Calendar", disabled: true },
    { label: "DG APPROVALS", icon: "Inbox", href: "/approvals/inbox", roles: ["approver", "dg"], phase: 3 },
    {
      label: "Administration", icon: "Settings",
      items: [
        { label: "Expense Categories", href: "/approvals/admin/categories", roles: ADMIN },
        { label: "Branches", href: "/approvals/admin/branches", roles: ADMIN },
        { label: "Publications", href: "/approvals/admin/publications", roles: ADMIN },
        { label: "Approver Rules", href: "/approvals/admin/rules", roles: ADMIN, phase: 3 },
        { label: "Roles and Access", href: "/approvals/admin/access", roles: ADMIN },
        { label: "Settings", href: "/approvals/admin/settings", roles: ADMIN },
        { label: "Audit Log", href: "/approvals/admin/audit", roles: ADMIN },
      ],
    },
  ] as NavEntry[],
};

/** A hub app card is the Approvals card when its URL is /approvals, with or without the domain in front. */
export const APPROVALS_URL_PATTERN = "^(https?://[^/?#]+)?/approvals/?$";
export const isApprovalsUrl = (url: string) => new RegExp(APPROVALS_URL_PATTERN).test(url.trim());

export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

export const canSee = (item: { roles?: readonly ApprovalsRole[] }, mine: readonly ApprovalsRole[]) =>
  !item.roles || item.roles.some((r) => mine.includes(r));

/** Every real (non-disabled) entry with a link, flattened. The placeholder route looks screens up here. */
export const allNavItems = (): NavItem[] =>
  approvalsManifest.nav.flatMap((e) => (isGroup(e) ? e.items : [e])).filter((i) => i.href && !i.disabled);
