/**
 * What the Inventory module is, for the host: its roles and its menu. Pure data (no server code), so the client sidebar can import it too.
 *
 * Roles:
 *   requester        everyone signed in to the hub: raise a request for an item, report a maintenance problem, follow their own
 *   inventory_staff  run the store: items and stock, issues and returns, requests, purchases, purchase orders, vendors, tickets
 *   inventory_admin  everything staff can do, plus who holds these roles and the module's settings
 * Staff and admin are granted in inventory_user_roles; the Support Admin is always an inventory_admin.
 */

export type InventoryRole = "requester" | "inventory_staff" | "inventory_admin";
export const ALL_ROLES: readonly InventoryRole[] = ["requester", "inventory_staff", "inventory_admin"];
/** The roles that run the store. Everyone else gets the requester's pages only. */
export const STAFF_ROLES: readonly InventoryRole[] = ["inventory_staff", "inventory_admin"];
export const ROLE_LABEL: Record<InventoryRole, string> = { requester: "Requester", inventory_staff: "Inventory staff", inventory_admin: "Inventory admin" };

export type InventoryNavItem = {
  label: string;
  href: string;
  /** Visible to anyone holding at least one of these roles; omitted means everyone. */
  roles?: readonly InventoryRole[];
  /** Not built yet: shown greyed out with a "Coming soon" tag, and not a link. */
  disabled?: boolean;
};

const STAFF = STAFF_ROLES;
const ADMIN = ["inventory_admin"] as const;

export const inventoryNav: InventoryNavItem[] = [
  { label: "Dashboard", href: "/inventory" },
  { label: "Items", href: "/inventory/items" },
  { label: "Categories", href: "/inventory/categories", roles: ADMIN },
  { label: "Requests", href: "/inventory/requests", disabled: true },
  { label: "Issues & returns", href: "/inventory/issues", roles: STAFF, disabled: true },
  { label: "Purchases", href: "/inventory/purchases", roles: STAFF, disabled: true },
  { label: "Purchase orders", href: "/inventory/purchase-orders", roles: STAFF, disabled: true },
  { label: "Vendors", href: "/inventory/vendors", roles: STAFF, disabled: true },
  { label: "Maintenance", href: "/inventory/maintenance", disabled: true },
  { label: "Settings", href: "/inventory/admin/settings", roles: ADMIN, disabled: true },
];

export const navFor = (roles: readonly InventoryRole[]) => inventoryNav.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r)));
