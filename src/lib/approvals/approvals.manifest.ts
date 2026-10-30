/**
 * What the Approvals module is, for the host: its name, where it is mounted, who may open it and what its menus hold.
 * Pure data (no server code), so the client menus can import it too.
 *
 * Approval System is a built-in item in the hub's sidebar with two applications under it, like the two Zoho apps it replaces:
 * "HR Approval" (HR requests, expenditure of the threshold and above, the DG's inbox) and "Expenditure" (expenses below the
 * threshold). Each application's menu is a row of section tabs with the pages of the chosen section under it.
 */

export type ApprovalsRole = "requester" | "approver" | "dg" | "viewer" | "approvals_admin";
export const ALL_ROLES: readonly ApprovalsRole[] = ["requester", "approver", "dg", "viewer", "approvals_admin"];

/**
 * Full access to the Approval System: every page the person's roles allow (lists, timelines, reports, the inbox, setup).
 * Everyone else who signs in to the hub holds none of these roles and gets the forms only: they fill in a request and follow their own.
 * This is the one place that decides it; the menus, the pages and the export all ask here.
 */
export const FULL_ACCESS_ROLES: readonly ApprovalsRole[] = ["approver", "dg", "viewer", "approvals_admin"];
export const hasFullAccess = (roles: readonly ApprovalsRole[]) => roles.some((r) => FULL_ACCESS_ROLES.includes(r));
/**
 * Who has "My Pending Approvals" and "My Approvals" in the sidebar: the people who decide or administer (HR Admin and Expense Admin as
 * approver, Super Admin as dg, Support Admin as approvals_admin). A plain requester does not, and the two pages are a 404 for them.
 */
export const MY_APPROVALS_ROLES: readonly ApprovalsRole[] = ["approver", "dg", "approvals_admin"];
/**
 * The Director General and nothing else: they see the forms and their Recommended Queue (and what they decided or rejected), not the
 * all-requests lists, timelines or reports. Anyone who also reviews first (approver), oversees (viewer) or administers is not "only" the DG.
 */
export const isDgOnly = (roles: readonly ApprovalsRole[]) => roles.includes("dg") && !roles.some((r) => r === "approver" || r === "viewer" || r === "approvals_admin");

export type NavItem = {
  label: string;
  href?: string;
  /** Visible to anyone holding at least one of these roles. Omitted: the forms (see `form`) are for everyone, anything else for full access. */
  roles?: readonly ApprovalsRole[];
  /** A form for raising a request. Only these are open to everyone; a page that is not marked is for people with full access. */
  form?: boolean;
  /** Shown greyed out with a "Coming soon" tag, and not a link. */
  disabled?: boolean;
};
export type NavGroup = { label: string; items: NavItem[]; roles?: readonly ApprovalsRole[] };
export type NavEntry = NavGroup | NavItem;

export type AppKey = "hr" | "exp";
export type NavApp = { key: AppKey; title: string; nav: NavEntry[] };

const HANDLERS = ["approver", "dg"] as const; // people who are asked to decide requests
const OVERSIGHT = ["viewer", "approvals_admin"] as const; // see every request, read only (an admin can also edit masters)
const ADMIN = ["approvals_admin"] as const;
/** The heading of the Support Admin's group of set-up screens (the Approval System page shows them as cards). */
const SETUP_GROUP_LABEL = "Setup & Configuration";

/**
 * Everyone sees the forms (marked `form`). Everything else, lists such as "Pending HR Request" included, is for people with full access
 * (see FULL_ACCESS_ROLES), and even there a person only sees the rows they may open. A plain requester follows their own request from the
 * confirmation after submitting, and from the notification that opens it.
 */
export const approvalsApps: NavApp[] = [
  {
    key: "hr",
    title: "HR Approval",
    nav: [
      {
        label: "Hr",
        items: [
          { label: "HR", href: "/approvals/hr/new", form: true },
          { label: "All Hr", href: "/approvals/hr/all" },
          { label: "All Requests Timeline", href: "/approvals/timeline" },
          { label: "HR Requests Report", href: "/approvals/hr/report", roles: OVERSIGHT },
          { label: "Approved HR requests", href: "/approvals/hr/approved" },
          { label: "Pending HR Request", href: "/approvals/hr/pending" },
          { label: "Rejected HR Requests", href: "/approvals/hr/rejected" },
          { label: "Processing Time Report", href: "/approvals/hr/approval-time", roles: OVERSIGHT },
        ],
      },
      {
        label: "Expenditures",
        items: [
          { label: "Expenditure", href: "/approvals/expenditures/new", form: true },
          { label: "All Expenditures", href: "/approvals/expenditures/all" },
          { label: "Approved Expenditure Requests", href: "/approvals/expenditures/approved" },
          { label: "Pending Expenditure Requests", href: "/approvals/expenditures/pending" },
          { label: "Rejected Expenditure Requests", href: "/approvals/expenditures/rejected" },
        ],
      },
      { label: "Event Approvals", disabled: true },
      { label: "Recommended Queue", href: "/approvals/inbox", roles: ["dg"] },
      {
        label: "Approvals", roles: HANDLERS,
        items: [
          { label: "Pending Approvals", href: "/approvals/my/pending", roles: ["approver"] },
          { label: "Recommended", href: "/approvals/my/recommended", roles: ["approver"] },
          { label: "Rejected Forms", href: "/approvals/my/rejected", roles: HANDLERS },
          { label: "Completed by me", href: "/approvals/my/completed", roles: HANDLERS },
          // "Approved Forms" in the Approval System sidebar: everyone has their own approved requests; people who decide, what they approved.
          { label: "Approved Forms", href: "/approvals/my/approved", roles: ["requester"] },
          { label: "Approved Forms", href: "/approvals/decided/approved", roles: HANDLERS },
        ],
      },
      {
        label: SETUP_GROUP_LABEL,
        roles: ADMIN,
        items: [
          { label: "Expense Types", href: "/approvals/admin/categories", roles: ADMIN },
          { label: "HR Request Types", href: "/approvals/admin/hr-categories", roles: ADMIN },
          { label: "Publication Types", href: "/approvals/admin/publications", roles: ADMIN },
          { label: "User Permissions", href: "/approvals/admin/access", roles: ADMIN },
          { label: "Notification Settings", href: "/approvals/admin/settings", roles: ADMIN },
          { label: "Full Audit Log", href: "/approvals/admin/audit", roles: ADMIN },
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
          { label: "Expenses", href: "/approvals/expenses/new", form: true },
          { label: "Approved Expenses", href: "/approvals/expenses/approved" },
        ],
      },
      {
        label: "Approvals",
        items: [
          { label: "Waiting for Me", href: "/approvals/expenses/pending", roles: ["approver"] },
          { label: "All Pending", href: "/approvals/expenses/waiting", roles: OVERSIGHT },
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

/**
 * A hub app row belongs to the Approval System when its address is /approvals (the old single card, with or without the domain in front)
 * or the entry page of one of its two applications (APP_ENTRY, written without a domain). Such a row is there so the Support Admin can
 * tick it for a person; it is never shown as a card in the hub or launched from there.
 */
export const APPROVALS_URL_PATTERN = "^((https?://[^/?#]+)?/approvals/?|/approvals/(hr|expenses)/new)$";
export const isApprovalsUrl = (url: string) => new RegExp(APPROVALS_URL_PATTERN).test(url.trim());

export const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

/**
 * Whether a menu entry is for this person. With roles listed, one of them is enough. Without: a section is shown (its pages decide what is
 * left in it), a form is shown to everyone, and any other page needs full access. Closed unless marked open, so a page added later is
 * never shown to everybody by accident.
 */
export const canSee = (entry: NavEntry, mine: readonly ApprovalsRole[]): boolean => {
  if (entry.roles) return entry.roles.some((r) => mine.includes(r));
  if (isGroup(entry)) return true;
  return !!entry.form || (hasFullAccess(mine) && !isDgOnly(mine));
};

/** Every entry with a link, flattened across both apps. The catch-all route looks screens up here. */
export const allNavItems = (): NavItem[] =>
  approvalsApps.flatMap((a) => a.nav).flatMap((e) => (isGroup(e) ? e.items : [e])).filter((i) => i.href);

/** Which of the two applications owns a page: the one holding its longest matching link, or null for pages in neither (a request). */
function appOwning(pathname: string): AppKey | null {
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

/**
 * The two places an approver works, under Approval System in the hub's sidebar: HR (the HR requests) and Expenditure (expenses of every size).
 * Each has three lists, Pending, Approved and Rejected, at /approvals/review/<place>/<list>.
 */
export type ReviewKey = "hr" | "expenditure";
export const REVIEW_KEYS: readonly ReviewKey[] = ["hr", "expenditure"];
export const REVIEW_LABEL: Record<ReviewKey | "recommendation", string> = { hr: "HR", expenditure: "Expenditure", recommendation: "Recommended" };
export const REVIEW_TABS = ["pending", "approved", "rejected"] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];
export const REVIEW_TAB_LABEL: Record<ReviewTab, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
/**
 * What the sidebar needs for one of them: which, and how many requests wait for this person there. The Director General has one place,
 * "recommendation" (what was recommended to them), with a tab each for HR and Expenditure; `counts` is what waits in each tab.
 */
export type ReviewItem = { key: ReviewKey | "recommendation"; waiting: number; counts?: Record<ReviewKey, number> };
/** Where a place opens: an approver's on its Pending list, the Director General's on the HR tab of what was recommended to them. */
export const reviewHref = (key: ReviewItem["key"]) => (key === "recommendation" ? "/approvals/review/recommendation/hr" : `/approvals/review/${key}/pending`);

/** The tab of the Director General's Recommended place a path names, or null. */
export function parseRecommendationPath(parts: readonly string[]): ReviewKey | null {
  const [head, place, key, ...rest] = parts;
  if (head !== "review" || place !== "recommendation" || rest.length > 0) return null;
  return REVIEW_KEYS.find((x) => x === key) ?? null;
}

/** The place and list a path under /approvals/review/ names, or null. */
export function parseReviewPath(parts: readonly string[]): { key: ReviewKey; tab: ReviewTab } | null {
  const [head, key, tab, ...rest] = parts;
  if (head !== "review" || rest.length > 0) return null;
  const k = REVIEW_KEYS.find((x) => x === key);
  const t = REVIEW_TABS.find((x) => x === tab);
  return k && t ? { key: k, tab: t } : null;
}

/** The page each application opens on when it is chosen in the hub's sidebar. */
export const APP_ENTRY: Record<AppKey, string> = { hr: "/approvals/hr/new", exp: "/approvals/expenses/new" };

/** Which application a request belongs to: HR requests and expenditure of the threshold and above are HR Approval; expenses below it are Expenditure. */
export const appForType = (type: "hr" | "expenditure_large" | "expenditure_small"): AppKey => (type === "expenditure_small" ? "exp" : "hr");

const parseApp = (v: string | null | undefined): AppKey | null => (v === "hr" || v === "exp" ? v : null);

/**
 * Which application a page is showing. A page in a menu belongs to its application; a request page says which with ?app= (the links to it
 * all carry it); anything else falls back to the application this person most likely works in.
 */
export function resolveApp(pathname: string, appParam: string | null, roles: readonly ApprovalsRole[]): AppKey {
  return appOwning(pathname) ?? parseApp(appParam) ?? (roles.some((r) => r === "approvals_admin" || r === "dg" || r === "viewer") ? "hr" : roles.includes("approver") ? "exp" : "hr");
}
