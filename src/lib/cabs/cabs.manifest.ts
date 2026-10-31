/**
 * What the Cab Booking module is, for the host: its three sections, who may open each, and their menus. Pure data and functions (no
 * server code), so the client sidebars and the unit tests can import it too.
 *
 * The module shows in the hub as three applications, each an ordinary row in Administrator → Applications with its own access grants:
 *   MCCIA Cabs    URL /cabs          staff book rides and follow them
 *   Cabs Driver   URL /cabs/driver   drivers see the rides given to them, and start and complete them
 *   Cabs Admin    URL /cabs/admin    admins assign drivers and vehicles, and run the fleet
 *
 * Roles:
 *   cab_admin   the Support Admin, and the App Admins of the Cabs Admin application
 *   cab_driver  anyone signed in whose email is a driver's in cab_drivers (added on Cabs Admin → Drivers), online or offline
 *   cab_user    anyone who has been given the MCCIA Cabs application
 */

export type CabRole = "cab_user" | "cab_driver" | "cab_admin";
export type CabSection = "staff" | "driver" | "admin";

/** The application rows that stand for each section: their URL is the section's own path. */
export const CABS_USER_URL_PATTERN = "^/cabs/?$";
export const CABS_DRIVER_URL_PATTERN = "^/cabs/driver/?$";
export const CABS_ADMIN_URL_PATTERN = "^/cabs/admin/?$";

/** The roles that open each section (any one is enough). Cabs admins also open Cabs Driver, to see it as a driver does. */
export const SECTION_ROLES: Record<CabSection, readonly CabRole[]> = { staff: ["cab_user"], driver: ["cab_driver", "cab_admin"], admin: ["cab_admin"] };

/** A person's roles from what the hub says about them (see the header). */
export function cabRolesFor(input: { hubRole: string; userAccess: boolean; adminAppAdmin: boolean; isDriver: boolean }): CabRole[] {
  const roles: CabRole[] = [];
  if (input.hubRole === "head_admin" || input.userAccess) roles.push("cab_user");
  if (input.isDriver) roles.push("cab_driver");
  if (input.hubRole === "head_admin" || input.adminAppAdmin) roles.push("cab_admin");
  return roles;
}

/**
 * A line of a section's menu (every line at the same level). `live`: a green dot while any ride is in progress. `badge`: "pending", a red
 * count of rides waiting for a driver; "login", an amber dot while a driver is waiting for a login OTP.
 */
export type CabNavItem = { label: string; href: string; live?: boolean; badge?: "pending" | "login" };

export const CAB_NAV: Record<CabSection, { title: string; items: CabNavItem[] }> = {
  staff: { title: "MCCIA Cabs", items: [
    { label: "Book", href: "/cabs" },
    { label: "My rides", href: "/cabs/rides" },
    { label: "Account", href: "/cabs/account" },
  ] },
  driver: { title: "Cabs Driver", items: [
    { label: "Assigned", href: "/cabs/driver" },
    { label: "Trip", href: "/cabs/driver/trip" },
    { label: "History", href: "/cabs/driver/rides" },
    { label: "Profile", href: "/cabs/driver/profile" },
  ] },
  admin: { title: "Cabs Admin", items: [
    { label: "Dashboard", href: "/cabs/admin" },
    { label: "Live Trips", href: "/cabs/admin/live", live: true },
    { label: "Pending Requests", href: "/cabs/admin/pending", badge: "pending" },
    { label: "Upcoming Rides", href: "/cabs/admin/upcoming" },
    { label: "All Trips", href: "/cabs/admin/trips" },
    { label: "Drivers", href: "/cabs/admin/drivers", badge: "login" },
    { label: "Vehicles", href: "/cabs/admin/vehicles" },
    { label: "Maintenance", href: "/cabs/admin/maintenance" },
    { label: "Payments", href: "/cabs/admin/payments" },
    { label: "Audit Log", href: "/cabs/admin/audit" },
  ] },
};

/** A section's menu, for someone holding one of its roles; nothing for anyone else. */
export const navFor = (section: CabSection, roles: readonly CabRole[]): CabNavItem[] => (SECTION_ROLES[section].some((r) => roles.includes(r)) ? CAB_NAV[section].items : []);

export const MAINTENANCE_TYPES = ["service", "repair", "inspection", "cleaning", "other"] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];
export const MAINTENANCE_LABEL: Record<MaintenanceType, string> = { service: "Service", repair: "Repair", inspection: "Inspection", cleaning: "Cleaning", other: "Other" };

export const INVOICE_STATUSES = ["draft", "sent", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const RIDE_STATUS_LABEL = { pending: "Pending", assigned: "Assigned", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" } as const;
export type RideStatus = keyof typeof RIDE_STATUS_LABEL;
export const RIDE_STATUSES = Object.keys(RIDE_STATUS_LABEL) as RideStatus[];
