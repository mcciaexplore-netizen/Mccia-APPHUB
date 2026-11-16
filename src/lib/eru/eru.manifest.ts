/**
 * What the ERU module is, for the host: its sections, who may open each, their menus, and its rules for projects. Pure data and functions
 * (no server code), so the client pages and the unit tests can import it too.
 *
 * The module shows in the hub as two applications, each an ordinary row in Administrator → Applications:
 *   ERU         URL /eru         the Economic Research Unit's workspace: domains, projects, documents
 *   ERU Admin   URL /eru/admin   the unit's admins: dashboard, every project, members, settings
 *
 * Roles (all read from the ERU application, /eru):
 *   eru_member       holds ERU and is one of its App Staff: sees every domain and project, creates projects, writes documents, comments
 *   eru_admin        holds ERU and is one of its App Admins: everything, plus managing projects, reviewing tracked changes, members, settings
 *   eru_super_admin  the Support Admin (head_admin) only: also "Delete all data"
 * Someone given ERU who is on neither list cannot open it. ERU Admin (/eru/admin) is the admins' tile; the Members page gives and takes it
 * away with the admin role, so Administrator and ERU always agree.
 */

import type { Priority, ProjectStatus } from "@/db/eru-schema";

export type EruRole = "eru_member" | "eru_admin" | "eru_super_admin";
export type EruSection = "workspace" | "admin";

export const ERU_USER_URL_PATTERN = "^/eru/?$";
export const ERU_ADMIN_URL_PATTERN = "^/eru/admin/?$";

/** A person's roles from what the hub says about them (see the header). */
export function eruRolesFor(input: { hubRole: string; access: boolean; appAdmin: boolean; appStaff: boolean }): EruRole[] {
  const head = input.hubRole === "head_admin";
  const roles: EruRole[] = [];
  if (head || (input.access && (input.appStaff || input.appAdmin))) roles.push("eru_member");
  if (head || (input.access && input.appAdmin)) roles.push("eru_admin");
  if (head) roles.push("eru_super_admin");
  return roles;
}

export const isSuperAdmin = (roles: readonly EruRole[]) => roles.includes("eru_super_admin");
export const isAdmin = (roles: readonly EruRole[]) => roles.includes("eru_admin") || isSuperAdmin(roles);
export const isMember = (roles: readonly EruRole[]) => roles.includes("eru_member") || isAdmin(roles);

export type EruNavItem = { label: string; href: string; adminOnly?: boolean; superOnly?: boolean };

export const ERU_NAV: Record<EruSection, { title: string; items: EruNavItem[] }> = {
  workspace: {
    title: "ERU Workspace",
    items: [
      { label: "Domains", href: "/eru" },
      { label: "My projects", href: "/eru/my-projects" },
      { label: "ERU Admin", href: "/eru/admin", adminOnly: true },
    ],
  },
  admin: {
    title: "ERU Admin",
    items: [
      { label: "Dashboard", href: "/eru/admin" },
      { label: "All Projects", href: "/eru/admin/projects" },
      { label: "Members", href: "/eru/admin/members" },
      { label: "Settings", href: "/eru/admin/settings" },
      { label: "ERU Workspace", href: "/eru" },
    ],
  },
};

/** A section's menu for someone allowed in it; nothing for anyone else. */
export function navFor(section: EruSection, roles: readonly EruRole[]): EruNavItem[] {
  const allowed = section === "workspace" ? isMember(roles) : isAdmin(roles);
  if (!allowed) return [];
  return ERU_NAV[section].items.filter((i) => (!i.adminOnly || isAdmin(roles)) && (!i.superOnly || isSuperAdmin(roles)));
}

// ── Domains ────────────────────────────────────────────────────────────────

export const DOMAIN_KEYS = ["policy_research", "primary_service", "research_papers", "quality_check", "internal_support"] as const;

/** The five seeded domains (the migration inserts exactly these). */
export const DEFAULT_DOMAINS: { key: (typeof DOMAIN_KEYS)[number]; name: string; color: DomainColor; icon: DomainIcon }[] = [
  { key: "policy_research", name: "Policy Research & Advocacy", color: "blue", icon: "landmark" },
  { key: "primary_service", name: "Primary Service", color: "green", icon: "clipboard-list" },
  { key: "research_papers", name: "Research Papers & Publications", color: "purple", icon: "book-open" },
  { key: "quality_check", name: "Quality Check", color: "orange", icon: "shield-check" },
  { key: "internal_support", name: "Internal Support", color: "gray", icon: "life-buoy" },
];

export const DOMAIN_COLORS = ["blue", "green", "purple", "orange", "gray", "red", "teal", "pink"] as const;
export type DomainColor = (typeof DOMAIN_COLORS)[number];
/** Accent, tint and text colour for each domain colour. */
const COLOR_HEX: Record<DomainColor, { accent: string; tint: string; text: string }> = {
  blue: { accent: "#2563eb", tint: "rgba(37, 99, 235, 0.09)", text: "#1d4ed8" },
  green: { accent: "#16a34a", tint: "rgba(22, 163, 74, 0.09)", text: "#15803d" },
  purple: { accent: "#7c3aed", tint: "rgba(124, 58, 237, 0.09)", text: "#6d28d9" },
  orange: { accent: "#ea580c", tint: "rgba(234, 88, 12, 0.09)", text: "#c2410c" },
  gray: { accent: "#64748b", tint: "rgba(100, 116, 139, 0.1)", text: "#475569" },
  red: { accent: "#dc2626", tint: "rgba(220, 38, 38, 0.08)", text: "#b91c1c" },
  teal: { accent: "#0d9488", tint: "rgba(13, 148, 136, 0.09)", text: "#0f766e" },
  pink: { accent: "#db2777", tint: "rgba(219, 39, 119, 0.08)", text: "#be185d" },
};
export const colorOf = (c: string) => COLOR_HEX[(DOMAIN_COLORS as readonly string[]).includes(c) ? (c as DomainColor) : "gray"];

export const DOMAIN_ICONS = ["landmark", "clipboard-list", "book-open", "shield-check", "life-buoy", "folder", "bar-chart", "globe", "briefcase", "file-text"] as const;
export type DomainIcon = (typeof DOMAIN_ICONS)[number];

// ── Projects ───────────────────────────────────────────────────────────────

export const STATUSES: ProjectStatus[] = ["draft", "active", "in_review", "completed", "archived"];
export const STATUS_LABEL: Record<ProjectStatus, string> = { draft: "Draft", active: "Active", in_review: "In review", completed: "Completed", archived: "Archived" };
export const STATUS_TONE: Record<ProjectStatus, "neutral" | "blue" | "purple" | "green" | "amber"> = {
  draft: "neutral",
  active: "blue",
  in_review: "purple",
  completed: "green",
  archived: "neutral",
};

export const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

/** The first moment of the current calendar month in India (IST, UTC+5:30), as a Date: "this month" for the dashboard and its list. */
export function istMonthStart(now: number = Date.now()): Date {
  const ist = new Date(now + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000);
}

/** ERU-0001, ERU-0042, ERU-12345: at least four digits. */
export const formatProjectNumber = (n: number) => `ERU-${String(Math.max(1, Math.floor(n))).padStart(4, "0")}`;

const MAX_TAGS = 10;
const MAX_LINKS = 10;
export const MAX_ASSIGNEES = 20;
export const MAX_FILE_MB = 25;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
/** The largest document content accepted in one save (the editor's JSON). */
export const MAX_CONTENT_BYTES = 2_500_000;
export const AUTOSAVE_MS = 30_000;

export type ProjectInput = {
  title: string;
  description?: string;
  domainId: string;
  priority?: string;
  status?: string;
  dueDate?: string | null;
  tags?: string[];
  referenceLinks?: string[];
};
export type CleanProject = { title: string; description: string; domainId: string; priority: Priority; status: ProjectStatus; dueDate: string | null; tags: string[]; referenceLinks: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);
const oneLine = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function checkLinks(input: string[] | undefined): { ok: true; value: string[] } | { ok: false; error: string } {
  const links = (input ?? []).map((l) => String(l).trim()).filter(Boolean);
  if (links.length > MAX_LINKS) return { ok: false, error: `Add at most ${MAX_LINKS} links` };
  for (const l of links) {
    let good = false;
    try {
      const u = new URL(l);
      good = (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname && l.length <= 500;
    } catch {
      good = false;
    }
    if (!good) return { ok: false, error: `Links: ${l.slice(0, 60)} must be a full web link, starting with https://` };
  }
  return { ok: true, value: [...new Set(links)] };
}

/** Tags: trimmed, one line, at most 40 characters each, no repeats (ignoring case), at most ten. */
export function cleanTags(input: string[] | undefined): string[] {
  const out: string[] = [];
  for (const t of input ?? []) {
    const tag = oneLine(t, 40);
    if (tag && !out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, MAX_TAGS);
}

/** Every check on a project before anything is stored. Pure, so the form and the unit tests share it. */
export function checkProject(input: ProjectInput): { ok: true; value: CleanProject } | { ok: false; error: string } {
  const title = oneLine(input.title, 200);
  if (title.length < 3) return { ok: false, error: "Give the project a title (at least 3 characters)" };
  if (!isUuid(input.domainId)) return { ok: false, error: "Choose a domain" };
  const description = String(input.description ?? "").replace(/\r\n/g, "\n").trim();
  if (description.length > 10_000) return { ok: false, error: "The description is too long" };
  const priority = (input.priority || "normal") as Priority;
  if (!PRIORITIES.includes(priority)) return { ok: false, error: "Choose a priority" };
  const status = (input.status || "active") as ProjectStatus;
  if (!STATUSES.includes(status)) return { ok: false, error: "Choose a status" };
  const dueDate = input.dueDate ? String(input.dueDate) : null;
  if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate)))) return { ok: false, error: "The due date is not a valid date" };
  const links = checkLinks(input.referenceLinks);
  if (!links.ok) return links;
  return { ok: true, value: { title, description, domainId: input.domainId, priority, status, dueDate, tags: cleanTags(input.tags), referenceLinks: links.value } };
}

export const DOCUMENT_TITLE_MAX = 200;
/** A document title: one line, at most 200 characters; empty becomes "Untitled document". */
export const cleanDocumentTitle = (t: unknown) => oneLine(t, DOCUMENT_TITLE_MAX) || "Untitled document";

/**
 * Who is told about a new comment: the document's creator, everyone assigned to its project, and every ERU admin. Never the person who
 * wrote it, and nobody twice.
 */
export function commentRecipients(i: { author: string; documentCreator: string; assigned: readonly string[]; admins: readonly string[] }): string[] {
  return [...new Set([i.documentCreator, ...i.assigned, ...i.admins])].filter((id) => !!id && id !== i.author);
}

/** Initials for an avatar: the first letters of the first and last names. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Who may do what with a project and its documents (see the header). The pages and the server use the same rules. */
export const can = {
  createProject: (roles: readonly EruRole[]) => isMember(roles),
  editProjectDetails: (roles: readonly EruRole[]) => isMember(roles),
  manageProject: (roles: readonly EruRole[]) => isAdmin(roles),
  deleteProject: (roles: readonly EruRole[]) => isAdmin(roles),
  editDocument: (roles: readonly EruRole[]) => isMember(roles),
  deleteDocument: (roles: readonly EruRole[]) => isAdmin(roles),
  reviewChanges: (roles: readonly EruRole[]) => isAdmin(roles),
  /** Anyone may switch track changes on; only an admin may switch it off. */
  setTrackChanges: (roles: readonly EruRole[], on: boolean) => (on ? isMember(roles) : isAdmin(roles)),
  manageMembers: (roles: readonly EruRole[]) => isAdmin(roles),
  manageSettings: (roles: readonly EruRole[]) => isAdmin(roles),
  deleteAllData: (roles: readonly EruRole[]) => isSuperAdmin(roles),
};
