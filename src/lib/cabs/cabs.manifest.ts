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
 *   cab_driver  anyone with an active row in cab_drivers (added on Cabs Admin → Drivers)
 *   cab_user    anyone who has been given the MCCIA Cabs application
 */

export type CabRole = "cab_user" | "cab_driver" | "cab_admin";
export type CabSection = "staff" | "driver" | "admin";

/** The application rows that stand for each section: their URL is the section's own path. */
export const CABS_USER_URL_PATTERN = "^/cabs/?$";
export const CABS_DRIVER_URL_PATTERN = "^/cabs/driver/?$";
export const CABS_ADMIN_URL_PATTERN = "^/cabs/admin/?$";

/** The role each section needs. */
export const SECTION_ROLE: Record<CabSection, CabRole> = { staff: "cab_user", driver: "cab_driver", admin: "cab_admin" };

/** A person's roles from what the hub says about them (see the header). */
export function cabRolesFor(input: { hubRole: string; userAccess: boolean; adminAppAdmin: boolean; isDriver: boolean }): CabRole[] {
  const roles: CabRole[] = [];
  if (input.hubRole === "head_admin" || input.userAccess) roles.push("cab_user");
  if (input.isDriver) roles.push("cab_driver");
  if (input.hubRole === "head_admin" || input.adminAppAdmin) roles.push("cab_admin");
  return roles;
}

export type CabNavItem = { label: string; href: string };

export const CAB_NAV: Record<CabSection, { title: string; items: CabNavItem[] }> = {
  staff: { title: "MCCIA Cabs", items: [
    { label: "Dashboard", href: "/cabs" },
    { label: "Book a Ride", href: "/cabs/book" },
    { label: "My Rides", href: "/cabs/rides" },
  ] },
  driver: { title: "Cabs Driver", items: [
    { label: "Dashboard", href: "/cabs/driver" },
    { label: "My Rides", href: "/cabs/driver/rides" },
  ] },
  admin: { title: "Cabs Admin", items: [
    { label: "Dashboard", href: "/cabs/admin" },
    { label: "All Rides", href: "/cabs/admin/rides" },
    { label: "Drivers", href: "/cabs/admin/drivers" },
    { label: "Vehicles", href: "/cabs/admin/vehicles" },
    { label: "Audit Log", href: "/cabs/admin/audit" },
  ] },
};

/** A section's menu, for someone holding its role; nothing for anyone else. */
export const navFor = (section: CabSection, roles: readonly CabRole[]): CabNavItem[] => (roles.includes(SECTION_ROLE[section]) ? CAB_NAV[section].items : []);

export const RIDE_STATUS_LABEL = { pending: "Pending", assigned: "Assigned", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" } as const;
export type RideStatus = keyof typeof RIDE_STATUS_LABEL;
export const RIDE_STATUSES = Object.keys(RIDE_STATUS_LABEL) as RideStatus[];
