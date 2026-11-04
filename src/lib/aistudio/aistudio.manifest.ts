/**
 * What the AI Studio module is, for the host: its sections, who may open each, their menus, and its rules for requests. Pure data and
 * functions (no server code), so the client pages and the unit tests can import it too.
 *
 * The module shows in the hub as two applications, each an ordinary row in Administrator → Applications with its own access grants:
 *   AI Studio         URL /aistudio         staff who ASK the AI Studio team for something: the request form and their own requests
 *   AI Studio Admin   URL /aistudio/admin   the AI STUDIO TEAM who work on requests: every request, notes, deliverables
 *
 * Roles:
 *   aistudio_requester    anyone given AI Studio
 *   aistudio_member       App Staff of AI Studio Admin (who also hold it): see every request, move it along, add notes and deliverables,
 *                         set its deadline and priority; not accept, decline, assign or delete
 *   aistudio_lead         App Admins of AI Studio Admin (who also hold it): everything, including accept/decline, assign and delete
 *   aistudio_super_admin  the Support Admin (head_admin) only: also Settings and "Delete all data"
 * Someone given AI Studio Admin who is on neither list cannot open it. The Support Admin holds all four.
 *
 * Data: a requester sees only the requests they made, never who works on them, and only the notes shared with them.
 */

import type { Priority, RequestStatus, RequestType } from "@/db/aistudio-schema";

export type AiRole = "aistudio_requester" | "aistudio_member" | "aistudio_lead" | "aistudio_super_admin";
export type AiSection = "requester" | "admin";

export const AISTUDIO_USER_URL_PATTERN = "^/aistudio/?$";
export const AISTUDIO_ADMIN_URL_PATTERN = "^/aistudio/admin/?$";

/** A person's roles from what the hub says about them (see the header). */
export function aiRolesFor(input: { hubRole: string; userAccess: boolean; adminAccess: boolean; adminAppAdmin: boolean; adminAppStaff: boolean }): AiRole[] {
  const head = input.hubRole === "head_admin";
  const roles: AiRole[] = [];
  if (head || input.userAccess) roles.push("aistudio_requester");
  if (head || (input.adminAccess && (input.adminAppStaff || input.adminAppAdmin))) roles.push("aistudio_member");
  if (head || (input.adminAccess && input.adminAppAdmin)) roles.push("aistudio_lead");
  if (head) roles.push("aistudio_super_admin");
  return roles;
}

export const isLead = (roles: readonly AiRole[]) => roles.includes("aistudio_lead") || roles.includes("aistudio_super_admin");
export const isMember = (roles: readonly AiRole[]) => roles.includes("aistudio_member") || isLead(roles);
export const isRequester = (roles: readonly AiRole[]) => roles.includes("aistudio_requester") || isMember(roles);

export type AiNavItem = { label: string; href: string; leadOnly?: boolean; badge?: "pending" };

export const AI_NAV: Record<AiSection, { title: string; items: AiNavItem[] }> = {
  requester: {
    title: "AI Studio",
    items: [
      { label: "New request", href: "/aistudio/request" },
      { label: "My requests", href: "/aistudio/my-requests" },
    ],
  },
  admin: {
    title: "AI Studio Admin",
    items: [
      { label: "Dashboard", href: "/aistudio/admin" },
      { label: "Pending Review", href: "/aistudio/admin/pending", badge: "pending" },
      { label: "All Requests", href: "/aistudio/admin/requests" },
      { label: "Settings", href: "/aistudio/admin/settings", leadOnly: true },
    ],
  },
};

/** A section's menu for someone allowed in it; nothing for anyone else. Lead-only lines need a lead. */
export function navFor(section: AiSection, roles: readonly AiRole[]): AiNavItem[] {
  const allowed = section === "requester" ? isRequester(roles) : isMember(roles);
  if (!allowed) return [];
  return AI_NAV[section].items.filter((i) => !i.leadOnly || isLead(roles));
}

// ── Requests ───────────────────────────────────────────────────────────────

export const REQUEST_TYPES: RequestType[] = ["app_development", "automation", "chatbot", "data_analysis", "website_tool", "other"];
export const TYPE_LABEL: Record<RequestType, string> = {
  app_development: "App Development",
  automation: "Automation / Workflow",
  chatbot: "AI Chatbot",
  data_analysis: "Data Analysis / Reports",
  website_tool: "Website / Tool",
  other: "Other",
};
export const TYPE_HINT: Record<RequestType, string> = {
  app_development: "Build a custom application or tool",
  automation: "Automate a repetitive task or process",
  chatbot: "Build a chatbot or AI assistant",
  data_analysis: "Analyse data or build reports/dashboards",
  website_tool: "Build or improve a website or web tool",
  other: "Describe below",
};

export const STATUSES: RequestStatus[] = ["pending_review", "accepted", "in_progress", "review_testing", "delivered", "closed", "declined"];
export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending_review: "Pending review",
  accepted: "Accepted",
  in_progress: "In progress",
  review_testing: "Review / Testing",
  delivered: "Delivered",
  closed: "Closed",
  declined: "Declined",
};
export const STATUS_TONE: Record<RequestStatus, "amber" | "blue" | "purple" | "green" | "neutral" | "red"> = {
  pending_review: "amber",
  accepted: "blue",
  in_progress: "blue",
  review_testing: "purple",
  delivered: "green",
  closed: "neutral",
  declined: "red",
};
/** The work in hand: accepted and not yet delivered. */
export const ACTIVE_STATUSES: RequestStatus[] = ["accepted", "in_progress", "review_testing"];

export const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

/** The requester's five steps. */
export const STEPS = ["Submitted", "Accepted", "In Progress", "Review/Testing", "Delivered"] as const;
const STEP_OF: Record<RequestStatus, number> = { pending_review: 0, accepted: 1, in_progress: 2, review_testing: 3, delivered: 4, closed: 4, declined: 0 };
/** How far along a request is: the index of its current step (Submitted = 0 ... Delivered = 4). */
export const stepOf = (s: RequestStatus) => STEP_OF[s];

/** AS-0001, AS-0042, AS-12345: at least four digits. */
export const formatRequestNumber = (n: number) => `AS-${String(Math.max(1, Math.floor(n))).padStart(4, "0")}`;

/**
 * Who may move a request from one status to another. Leads: any move except back to Pending review or out of Declined (accepting and
 * declining go through their own steps). Members: along the work (Accepted, In progress, Review/Testing, Delivered, in either direction) but never accept,
 * decline, close or reopen. Delivering needs a deliverable (checked where it is done).
 */
export function canMove(role: "lead" | "member", from: RequestStatus, to: RequestStatus): boolean {
  if (from === to || to === "pending_review") return false;
  if (from === "pending_review" || from === "declined") return false; // accept/decline only; a declined request stays declined
  if (role === "lead") return to !== "declined";
  const work: RequestStatus[] = ["accepted", "in_progress", "review_testing", "delivered"];
  return work.includes(from) && work.includes(to);
}

// ── The request form ───────────────────────────────────────────────────────

export const MAX_FILES = 5;
export const MAX_FILE_MB = 10;
export const MAX_DELIVERABLE_MB = 50;
export const MAX_LINKS = 5;
export const MAX_CONTENT = 20_000;

/** Upload limit in bytes, by what the file is for. */
export const uploadLimit = (purpose: "attachment" | "deliverable") => (purpose === "deliverable" ? MAX_DELIVERABLE_MB : MAX_FILE_MB) * 1024 * 1024;

export type RequestInput = {
  requestType: string;
  title: string;
  description: string;
  department?: string;
  referenceLinks?: string[];
  content?: string;
  fileIds?: string[];
};
export type CleanRequest = { requestType: RequestType; title: string; description: string; department: string | null; referenceLinks: string[]; content: string | null; fileIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oneLine = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Every check on a request before anything is stored. Pure, so the form and the unit tests share it. */
export function checkRequest(input: RequestInput): { ok: true; value: CleanRequest } | { ok: false; error: string } {
  if (!REQUEST_TYPES.includes(input.requestType as RequestType)) return { ok: false, error: "Choose what you need" };
  const title = oneLine(input.title, 200);
  if (title.length < 3) return { ok: false, error: "Give the project a name" };
  const description = String(input.description ?? "").replace(/\r\n/g, "\n").trim();
  if (description.length < 10) return { ok: false, error: "Describe what you need (a sentence or two at least)" };
  if (description.length > 10_000) return { ok: false, error: "The description is too long: put the details in a document and attach it" };
  const links = (input.referenceLinks ?? []).map((l) => String(l).trim()).filter(Boolean);
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
  const content = String(input.content ?? "").replace(/\r\n/g, "\n").trim();
  if (content.length > MAX_CONTENT) return { ok: false, error: "The content is too long: put it in a document and attach it" };
  const fileIds = [...new Set(input.fileIds ?? [])];
  if (fileIds.length > MAX_FILES) return { ok: false, error: `Attach at most ${MAX_FILES} files` };
  if (fileIds.some((f) => !UUID.test(f))) return { ok: false, error: "An attached file could not be found. Please attach it again." };
  return {
    ok: true,
    value: { requestType: input.requestType as RequestType, title, description, department: oneLine(input.department, 120) || null, referenceLinks: links, content: content || null, fileIds },
  };
}
