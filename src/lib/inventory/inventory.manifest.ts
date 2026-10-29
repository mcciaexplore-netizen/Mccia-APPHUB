/**
 * What the Inventory module is, for the host: who may open it, its roles and its menu. Pure data and functions (no server code), so the
 * client sidebar and the unit tests can import it too.
 *
 * Access works like every other application in the hub: the Support Admin can always open it; everyone else needs to have been given the
 * Inventory application (a row in Administrator → Applications whose URL is /inventory) with the shield button.
 *
 * Roles come from the hub; nothing is granted inside the module:
 *   inventory_admin  the Support Admin, and the App Admins of the Inventory application (its Edit form in Administrator → Applications):
 *                    everything (items, categories, vendors, purchase orders, requests, issues and returns, maintenance, the stock history)
 *   requester        everyone else who may open it: the dashboard, the item list (to look), and their own requests and maintenance tickets
 */

export type InventoryRole = "requester" | "inventory_admin";
export const ALL_ROLES: readonly InventoryRole[] = ["requester", "inventory_admin"];
export const ROLE_LABEL: Record<InventoryRole, string> = { requester: "User", inventory_admin: "Inventory admin" };

/** Inventory admin: the Support Admin always, anyone else only as an App Admin of the Inventory application. */
export const inventoryRoleFor = (hubRole: string, isAppAdmin: boolean): InventoryRole => (hubRole === "head_admin" || isAppAdmin ? "inventory_admin" : "requester");

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

const ADMIN = ["inventory_admin"] as const;

export const inventoryNav: InventoryNavItem[] = [
  { label: "Dashboard", href: "/inventory" },
  { label: "Items", href: "/inventory/items" },
  { label: "Categories", href: "/inventory/categories", roles: ADMIN },
  { label: "Requests", href: "/inventory/requests" },
  { label: "Issues & returns", href: "/inventory/issues", roles: ADMIN },
  { label: "Stock movements", href: "/inventory/movements", roles: ADMIN },
  { label: "Purchases", href: "/inventory/purchases", roles: ADMIN },
  { label: "Purchase orders", href: "/inventory/purchase-orders", roles: ADMIN },
  { label: "Vendors", href: "/inventory/vendors", roles: ADMIN },
  { label: "Maintenance", href: "/inventory/maintenance" },
];

export const navFor = (roles: readonly InventoryRole[]) => inventoryNav.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r)));
