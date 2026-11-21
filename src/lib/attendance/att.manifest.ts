/**
 * What the Attendance module is, for the host: its two applications, who may open each, their menus, and who decides a request. Pure data
 * and functions (no server code), so the client pages and the unit tests can import it too.
 *
 * The module shows in the hub as two applications, each an ordinary row in Administrator → Applications:
 *   Attendance        URL /attendance         every member of staff: check in/out, leave, WFH, regularization, comp-off, time, feeds
 *   Attendance Admin  URL /attendance/admin   HR: today, approvals, people, attendance, leave and time trackers, reports, settings
 *
 * Roles:
 *   attendance_member       anyone given the Attendance tile (user_app_access on /attendance)
 *   attendance_admin        an App Admin of Attendance Admin (/attendance/admin): HR. Also a member (HR check in too).
 *   attendance_super_admin  the Support Admin (head_admin): everything
 *
 * Requests go to the person's reporting manager (the hub's users.reporting_manager_id). With no active manager they go to HR. HR may decide
 * anything; nobody decides their own request.
 *
 * Feature flag: ATT_ENABLED=true (flags.ts). Off, every page and route answers 404.
 */

export const ATT_APP_NAME = "Attendance";
export const ATT_ADMIN_APP_NAME = "Attendance Admin";

export type AttRole = "attendance_member" | "attendance_admin" | "attendance_super_admin";
export type AttSection = "staff" | "admin";

export const ATT_USER_URL_PATTERN = "^/attendance/?$";
export const ATT_ADMIN_URL_PATTERN = "^/attendance/admin/?$";

/** A person's roles from what the hub says about them (see the header). */
export function attRolesFor(input: { hubRole: string; access: boolean; adminAppAdmin: boolean }): AttRole[] {
  const head = input.hubRole === "head_admin";
  const roles: AttRole[] = [];
  if (head || input.access || input.adminAppAdmin) roles.push("attendance_member");
  if (head || input.adminAppAdmin) roles.push("attendance_admin");
  if (head) roles.push("attendance_super_admin");
  return roles;
}

export const isSuperAdmin = (roles: readonly AttRole[]) => roles.includes("attendance_super_admin");
export const isAdmin = (roles: readonly AttRole[]) => roles.includes("attendance_admin") || isSuperAdmin(roles);
export const isMember = (roles: readonly AttRole[]) => roles.includes("attendance_member") || isAdmin(roles);

export type AttNavItem = { label: string; href: string; icon: "home" | "leave" | "time" | "more" | "today" | "approvals" | "people" | "attendance" | "tracker" | "reports" | "settings" | "back"; adminOnly?: boolean };

export const ATT_NAV: Record<AttSection, { title: string; items: AttNavItem[] }> = {
  staff: {
    title: "Attendance",
    items: [
      { label: "Dashboard", href: "/attendance", icon: "home" },
      { label: "Attendance", href: "/attendance/more/summary", icon: "attendance" },
      { label: "Leave", href: "/attendance/leave", icon: "leave" },
      { label: "Time", href: "/attendance/time", icon: "time" },
      { label: "More", href: "/attendance/more", icon: "more" },
      { label: "Attendance Admin", href: "/attendance/admin", icon: "settings", adminOnly: true },
    ],
  },
  admin: {
    title: "Attendance Admin",
    items: [
      { label: "Today", href: "/attendance/admin", icon: "today" },
      { label: "Approvals", href: "/attendance/admin/approvals", icon: "approvals" },
      { label: "People", href: "/attendance/admin/people", icon: "people" },
      { label: "Attendance", href: "/attendance/admin/attendance", icon: "attendance" },
      { label: "Leave Tracker", href: "/attendance/admin/leave", icon: "leave" },
      { label: "Time Tracker", href: "/attendance/admin/time", icon: "time" },
      { label: "Reports", href: "/attendance/admin/reports", icon: "reports" },
      { label: "Settings", href: "/attendance/admin/settings", icon: "settings" },
      { label: "My Attendance", href: "/attendance", icon: "back" },
    ],
  },
};

/** A section's menu for someone allowed in it; nothing for anyone else. */
export function navFor(section: AttSection, roles: readonly AttRole[]): AttNavItem[] {
  const allowed = section === "staff" ? isMember(roles) : isAdmin(roles);
  if (!allowed) return [];
  return ATT_NAV[section].items.filter((i) => !i.adminOnly || isAdmin(roles));
}

/** The pages under More, in order. */
export const MORE_LINKS = [
  { label: "Attendance summary", href: "/attendance/more/summary", note: "Your days, hours, late and early marks" },
  { label: "Team approvals", href: "/attendance/more/approvals", note: "Requests waiting for you as a manager", managerOnly: true },
  { label: "Regularization", href: "/attendance/more/regularization", note: "Correct a missed check-in or check-out" },
  { label: "Work from home", href: "/attendance/more/wfh", note: "Ask to work from home on a day" },
  { label: "Comp-off", href: "/attendance/more/compoff", note: "Claim a day off for working a holiday or weekly off" },
  { label: "Profile", href: "/attendance/more/profile", note: "Your shift, manager and dates" },
  { label: "Org chart", href: "/attendance/more/org-chart", note: "Who reports to whom" },
] as const;

// ── Requests and who decides them ─────────────────────────────────────────

export type RequestKind = "leave" | "wfh" | "regularization" | "compoff" | "timesheet";
export const REQUEST_KIND_LABEL: Record<RequestKind, string> = { leave: "Leave", wfh: "Work from home", regularization: "Regularization", compoff: "Comp-off", timesheet: "Timesheet" };
export const REQUEST_KINDS: RequestKind[] = ["leave", "wfh", "regularization", "compoff", "timesheet"];

/** Who a new request is sent to: the reporting manager while they are active and not the person themself; otherwise HR (null). */
export function approverFor(person: { id: string; managerId: string | null }, activeManager: boolean): string | null {
  return person.managerId && activeManager && person.managerId !== person.id ? person.managerId : null;
}

/** Whether `actor` may decide a request: never their own; HR always; otherwise only the person it was sent to. */
export function canDecide(actor: { id: string; hr: boolean }, request: { userId: string; approverId: string | null }): boolean {
  if (actor.id === request.userId) return false;
  if (actor.hr) return true;
  return !!request.approverId && request.approverId === actor.id;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** Initials for an avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export const EMPLOYMENT_TYPES = ["staff", "consultant", "intern"] as const;
export const EMPLOYMENT_LABEL: Record<(typeof EMPLOYMENT_TYPES)[number], string> = { staff: "Staff", consultant: "Consultant", intern: "Intern" };

export const LEAVE_COLORS = ["blue", "red", "green", "orange", "purple", "teal", "pink", "gray"] as const;
const COLOR_HEX: Record<string, string> = { blue: "#2563eb", red: "#dc2626", green: "#16a34a", orange: "#ea580c", purple: "#7c3aed", teal: "#0d9488", pink: "#db2777", gray: "#64748b" };
export const leaveColor = (c: string) => COLOR_HEX[c] ?? COLOR_HEX.gray;

export const MAX_REASON = 1000;
export const MAX_FILE_MB = 5;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const ALLOWED_DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];
