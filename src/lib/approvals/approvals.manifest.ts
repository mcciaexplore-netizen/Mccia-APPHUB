/**
 * What the Approvals module is, for the host: its name, where it is mounted, who may open it and what its menus hold.
 * Pure data (no server code), so the client menus can import it too.
 *
 * Approval System is a built-in item in the hub's sidebar with two applications under it, like the two Zoho apps it replaces:
 * "HR Approval" (HR requests, expenditure of the threshold and above, budgets, the DG's inbox) and "Expenditure" (expenses below the
 * threshold). Each application's menu is a row of section tabs with the pages of the chosen section under it.
 */

export type ApprovalsRole = "requester" | "approver" | "dg" | "viewer" | "approvals_admin";
export const ALL_ROLES: readonly ApprovalsRole[] = ["requester", "approver", "dg", "viewer", "approvals_admin"];

export type NavItem = {
  label: string;
  href?: string;
  /** Visible to anyone holding at least one of these roles. Omitted means everyone. */
  roles?: readonly ApprovalsRole[];
  /** Shown greyed out with a "Coming soon" tag, and not a link. */
  disabled?: boolean;
};
export type NavGroup = { label: string; items: NavItem[]; roles?: readonly ApprovalsRole[] };
export type NavEntry = NavGroup | NavItem;

export type AppKey = "hr" | "exp";
export type NavApp = { key: AppKey; title: string; nav: NavEntry[] };

const HANDLERS = ["approver", "dg"] as const; // people who are asked to decide requests
const OVERSIGHT = ["viewer", "dg", "approvals_admin"] as const; // see every request and every budget, read only (an admin can also edit masters)
const ADMIN = ["approvals_admin"] as const;

/**
 * Lists such as "Pending HR Request" are open to everyone: a person only ever sees the rows they are allowed to (their own, or the ones
 * routed to them), so a requester can follow their own requests there.
 */
export const approvalsApps: NavApp[] = [
  {
    key: "hr",
    title: "HR Approval",
    nav: [
      {
        label: "Hr",
        items: [
          { label: "HR", href: "/approvals/hr/new" },
          { label: "All Hr", href: "/approvals/hr/all" },
          { label: "HR Approval Categories", href: "/approvals/admin/hr-categories", roles: ADMIN },
          { label: "HR Approval Timeline", href: "/approvals/hr/timeline" },
          { label: "Approval Timeline", href: "/approvals/timeline" },
          { label: "HR Report", href: "/approvals/hr/report", roles: OVERSIGHT },
          { label: "Approved HR requests", href: "/approvals/hr/approved" },
          { label: "Pending HR Request", href: "/approvals/hr/pending" },
          { label: "Rejected HR Requests", href: "/approvals/hr/rejected" },
          { label: "Approval Time", href: "/approvals/hr/approval-time", roles: OVERSIGHT },
        ],
      },
      {
        label: "Expenditures",
        items: [
          { label: "Expenditure", href: "/approvals/expenditures/new" },
          { label: "All Expenditures", href: "/approvals/expenditures/all" },
          { label: "Approved Expenditure Requests", href: "/approvals/expenditures/approved" },
          { label: "Pending Expenditure Requests", href: "/approvals/expenditures/pending" },
          { label: "Rejected Expenditure Requests", href: "/approvals/expenditures/rejected" },
        ],
      },
      {
        label: "All_Budgets",
        items: [
          { label: "Budgets", href: "/approvals/budgets", roles: OVERSIGHT },
          { label: "Budget Utilisation", href: "/approvals/budgets/utilisation", roles: OVERSIGHT },
        ],
      },
      { label: "Event Approvals", disabled: true },
      { label: "DG APPROVALS", href: "/approvals/inbox", roles: HANDLERS },
      {
        label: "Approvals", roles: HANDLERS,
        items: [
          { label: "Waiting for my approval", href: "/approvals/my/pending", roles: HANDLERS },
          { label: "Completed by me", href: "/approvals/my/completed", roles: HANDLERS },
        ],
      },
      {
        label: "Administration",
        items: [
          { label: "Setup", href: "/approvals/admin/setup", roles: ADMIN },
          { label: "Expense Categories", href: "/approvals/admin/categories", roles: ADMIN },
          { label: "Branches", href: "/approvals/admin/branches", roles: ADMIN },
          { label: "Publications", href: "/approvals/admin/publications", roles: ADMIN },
          { label: "Approver Rules", href: "/approvals/admin/rules", roles: ADMIN },
          { label: "Roles and Access", href: "/approvals/admin/access", roles: ADMIN },
          { label: "Settings", href: "/approvals/admin/settings", roles: ADMIN },
          { label: "Audit Log", href: "/approvals/admin/audit", roles: ADMIN },
        ],
      },
    ],
  },
  {
    key: "exp",
    title: "Expenditure",
    nav: [
      {
        label: "Expenses",
        items: [
          { label: "Expenses", href: "/approvals/expenses/new" },
          { label: "Approved Expenses", href: "/approvals/expenses/approved" },
        ],
      },
      {
        label: "Approvals",
        items: [
          { label: "Pending", href: "/approvals/expenses/pending" },
          { label: "My Requests", href: "/approvals/expenses/mine" },
          { label: "Rejected Expenses", href: "/approvals/expenses/rejected" },
        ],
      },
    ],
  },
];

/**
 * Whether Approvals is on, from the APPROVALS_ENABLED setting. It is ON unless the setting says otherwise ("false", "0", "off" or "no"):
 * an unset or empty value means on, so the feature is there as soon as it is deployed and nobody has to remember to switch it on.
 */
export const isModuleEnabled = (setting: string | undefined): boolean => !["false", "0", "off", "no"].includes((setting ?? "").trim().toLowerCase());

/** A hub app card is the Approvals card when its URL is /approvals, with or without the domain in front. */
export const APPROVALS_URL_PATTERN = "^(https?://[^/?#]+)?/approvals/?$";
export const isApprovalsUrl = (url: string) => new RegExp(APPROVALS_URL_PATTERN).test(url.trim());

export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

export const canSee = (item: { roles?: readonly ApprovalsRole[] }, mine: readonly ApprovalsRole[]) =>
  !item.roles || item.roles.some((r) => mine.includes(r));

/** Every entry with a link, flattened across both apps. The catch-all route looks screens up here. */
export const allNavItems = (): NavItem[] =>
  approvalsApps.flatMap((a) => a.nav).flatMap((e) => (isGroup(e) ? e.items : [e])).filter((i) => i.href);

/** Which of the two applications owns a page: the one holding its longest matching link, or null for pages in neither (a request). */
export function appOwning(pathname: string): AppKey | null {
  let best: { key: AppKey; len: number } | null = null;
  for (const app of approvalsApps) {
    for (const e of app.nav) {
      for (const i of isGroup(e) ? e.items : [e]) {
        const h = i.href;
        if (h && (pathname === h || pathname.startsWith(`${h}/`)) && (!best || h.length > best.len)) best = { key: app.key, len: h.length };
      }
    }
  }
  return best?.key ?? null;
}

/** The page each application opens on when it is chosen in the hub's sidebar. */
export const APP_ENTRY: Record<AppKey, string> = { hr: "/approvals/hr/new", exp: "/approvals/expenses/new" };

/** Which application a request belongs to: HR requests and expenditure of the threshold and above are HR Approval; expenses below it are Expenditure. */
export const appForType = (type: "hr" | "expenditure_large" | "expenditure_small"): AppKey => (type === "expenditure_small" ? "exp" : "hr");

export const parseApp = (v: string | null | undefined): AppKey | null => (v === "hr" || v === "exp" ? v : null);

/**
 * Which application a page is showing. A page in a menu belongs to its application; a request page says which with ?app= (the links to it
 * all carry it); anything else falls back to the application this person most likely works in.
 */
export function resolveApp(pathname: string, appParam: string | null, roles: readonly ApprovalsRole[]): AppKey {
  return appOwning(pathname) ?? parseApp(appParam) ?? (roles.some((r) => r === "approvals_admin" || r === "dg" || r === "viewer") ? "hr" : roles.includes("approver") ? "exp" : "hr");
}
