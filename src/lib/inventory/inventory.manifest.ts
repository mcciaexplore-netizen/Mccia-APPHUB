/**
 * What the Inventory module is, for the host: who may open it, its roles and its menu. Pure data and functions (no server code), so the
 * client sidebar and the unit tests can import it too.
 *
 * Access works like every other application in the hub: the Support Admin can always open it; everyone else needs to have been given the
 * Inventory application (a row in Administrator → Applications whose URL is /inventory) with the shield button.
 *
 * Roles come from the hub; nothing is granted inside the module. All three are set on the Inventory application's Edit form in
 * Administrator → Applications:
 *   inventory_admin  the Support Admin, and the App Admins of the Inventory application: everything (items, categories, vendors, purchase
 *                    orders, requests, issues and returns, maintenance, the stock history)
 *   inventory_staff  its App Staff: what a user has, plus the item list, where they add, edit and delete items
 *   requester        everyone else who may open it: the dashboard, and their own requests and maintenance tickets
 */

export type InventoryRole = "requester" | "inventory_staff" | "inventory_admin";
export const ROLE_LABEL: Record<InventoryRole, string> = { requester: "User", inventory_staff: "Staff", inventory_admin: "Inventory admin" };

/** Inventory admin: the Support Admin always, anyone else only as an App Admin of the Inventory application. Staff: its App Staff. */
export const inventoryRoleFor = (hubRole: string, isAppAdmin: boolean, isAppStaff = false): InventoryRole =>
  hubRole === "head_admin" || isAppAdmin ? "inventory_admin" : isAppStaff ? "inventory_staff" : "requester";

/** Who may look at the item list: Staff and Inventory admins. */
export const SEES_ITEMS = ["inventory_staff", "inventory_admin"] as const satisfies readonly InventoryRole[];
/** Who may add, edit and delete items (and add one to another branch): Staff and Inventory admins. */
export const MANAGES_ITEMS = SEES_ITEMS;
/**
 * Who sees every branch (with a branch filter on items, requests and the dashboard): Staff and Inventory admins. A user sees only their own
 * branch's stock and requests from it.
 */
export const SEES_ALL_BRANCHES = SEES_ITEMS;

/** The application rows that stand for this module: their URL is the module's own path (as /approvals is for the Approval System). */
export const INVENTORY_URL_PATTERN = "^/inventory/?$";

export type InventoryNavItem = {
  label: string;
  href: string;
  /** Visible to anyone holding at least one of these roles; omitted means everyone. */
  roles?: readonly InventoryRole[];
  /** Not built yet: shown greyed out with a "Coming soon" tag, and not a link. */
  disabled?: boolean;
};

/** A collapsible heading with the pages under it (Inventory, Maintenance). It is not a page itself. */
export type InventoryNavGroup = { label: string; children: InventoryNavItem[] };
export type InventoryNavEntry = InventoryNavItem | InventoryNavGroup;
export const isNavGroup = (e: InventoryNavEntry): e is InventoryNavGroup => "children" in e;

const ADMIN = ["inventory_admin"] as const;

/** The AMC page lives under /inventory/admin/, beside the Audit Log: Inventory admins only. */
export const AMC_PATH = "/inventory/admin/maintenance/amc";

export const inventoryNav: InventoryNavEntry[] = [
  { label: "Dashboard", href: "/inventory" },
  {
    label: "Inventory",
    children: [
      { label: "Items", href: "/inventory/items", roles: SEES_ITEMS },
      { label: "Categories", href: "/inventory/categories", roles: ADMIN },
      { label: "Requests", href: "/inventory/requests" },
      { label: "Issues & Returns", href: "/inventory/issues", roles: ADMIN },
      { label: "Stock Movements", href: "/inventory/movements", roles: ADMIN },
      { label: "Transfers", href: "/inventory/transfers", roles: ADMIN },
      { label: "Purchases", href: "/inventory/purchases", roles: ADMIN },
      { label: "Purchase Orders", href: "/inventory/purchase-orders", roles: ADMIN },
    ],
  },
  { label: "Vendors", href: "/inventory/vendors", roles: ADMIN },
  {
    label: "Maintenance",
    children: [
      // The maintenance tickets everyone raises and Inventory admins resolve: the page that was "Maintenance" before it became a group.
      { label: "Tickets", href: "/inventory/maintenance" },
      { label: "AMC", href: AMC_PATH, roles: ADMIN },
    ],
  },
  { label: "Audit Log", href: "/inventory/admin/audit", roles: ADMIN },
];

const visible = (i: InventoryNavItem, roles: readonly InventoryRole[]) => !i.roles || i.roles.some((r) => roles.includes(r));

/** The menu this person sees: what their roles open, and a group only while at least one page under it is open to them. */
export const navFor = (roles: readonly InventoryRole[]): InventoryNavEntry[] =>
  inventoryNav.flatMap((e): InventoryNavEntry[] => {
    if (!isNavGroup(e)) return visible(e, roles) ? [e] : [];
    const children = e.children.filter((c) => visible(c, roles));
    return children.length ? [{ ...e, children }] : [];
  });
