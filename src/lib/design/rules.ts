/**
 * DesignDesk's workflow rules, as pure functions (no database, no server code) so the pages, the server and the unit tests share one copy:
 * statuses and their labels, priority from the delivery date, working-hours deadlines, the requester's five progress steps, the change
 * cut-off before an event, ticket numbers and revision tags. Times are IST (the studio's clock), whatever the server's zone.
 */
import type { ApprovalStatus, Priority, TicketStatus } from "@/db/design-schema";

export const IST_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const STATUS_LABEL: Record<TicketStatus, string> = {
  pending_review: "Pending review",
  new: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  waiting_on_requester: "Waiting on requester",
  in_review: "In review",
  delivered: "Delivered",
  closed: "Closed",
  closed_without_approval: "Closed without approval",
  superseded: "Changes requested",
  declined: "Declined",
};

/** The board's columns, in order. */
export const BOARD_STATUSES: TicketStatus[] = ["new", "assigned", "in_progress", "waiting_on_requester", "in_review", "delivered", "closed"];
/** Work that still needs a designer. */
export const OPEN_STATUSES: TicketStatus[] = ["new", "assigned", "in_progress", "waiting_on_requester", "in_review"];
/** Work a designer is actively spending hours on (counts towards their load). */
export const ACTIVE_STATUSES: TicketStatus[] = ["new", "assigned", "in_progress"];
export const FINISHED_STATUSES: TicketStatus[] = ["delivered", "closed", "closed_without_approval"];
/** Statuses that never appear on a board or the all-requests list. */
export const OFF_BOARD_STATUSES: TicketStatus[] = ["pending_review", "declined"];
export const DEFAULT_WIP_LIMITS: Partial<Record<TicketStatus, number>> = { assigned: 12, in_progress: 8, in_review: 10 };

export const STATUS_TONE: Record<TicketStatus, "neutral" | "blue" | "amber" | "purple" | "green" | "red"> = {
  pending_review: "amber",
  new: "neutral",
  assigned: "blue",
  in_progress: "blue",
  waiting_on_requester: "amber",
  in_review: "purple",
  delivered: "green",
  closed: "green",
  closed_without_approval: "neutral",
  superseded: "neutral",
  declined: "red",
};

export const PRIORITIES: Priority[] = ["urgent", "high", "normal", "low"];
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

export const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  pending: "Waiting for the requester",
  approved: "Approved",
  changes_requested: "Changes requested",
  revoked: "Withdrawn",
  expired: "Expired",
};

/** The steps a requester sees, in order, and where each status sits on them. */
export const STEPS = ["Received", "Assigned", "In progress", "In review", "Delivered"] as const;
export function stepOf(status: TicketStatus): number {
  switch (status) {
    case "pending_review":
    case "new":
    case "declined":
      return 0;
    case "assigned":
      return 1;
    case "in_progress":
    case "waiting_on_requester":
    case "superseded":
      return 2;
    case "in_review":
      return 3;
    default:
      return 4;
  }
}

/** The requester's filter tabs on My Requests. */
export const REQUESTER_TABS = ["all", "pending", "in_progress", "in_review", "delivered", "closed"] as const;
export type RequesterTab = (typeof REQUESTER_TABS)[number];
export const REQUESTER_TAB_LABEL: Record<RequesterTab, string> = {
  all: "All",
  pending: "Pending",
  in_progress: "In progress",
  in_review: "In review",
  delivered: "Delivered",
  closed: "Closed",
};
export function requesterTabOf(status: TicketStatus): Exclude<RequesterTab, "all"> {
  if (status === "pending_review" || status === "new") return "pending";
  if (status === "in_review") return "in_review";
  if (status === "delivered") return "delivered";
  if (status === "closed" || status === "closed_without_approval" || status === "superseded" || status === "declined") return "closed";
  return "in_progress";
}

// ── IST dates ────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" for a moment, on the IST calendar. */
export function istDate(at: Date | number = Date.now()): string {
  return new Date(+at + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
/** The moment an IST wall-clock time happens. */
export function istMoment(day: string, hour = 0, minute = 0): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - IST_OFFSET_MIN * 60_000);
}
/** Whole days from one IST date to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
/** 0 = Monday … 6 = Sunday, for an IST date. */
export function weekdayOf(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Priority follows how soon the design is needed; the form never asks for it. */
export function priorityFor(deliveryDate: string, today: string = istDate()): Priority {
  const days = daysBetween(today, deliveryDate);
  if (days <= 1) return "urgent";
  if (days <= 3) return "high";
  if (days <= 10) return "normal";
  return "low";
}

/** Form requests are due at 18:00 IST on the delivery date asked for. */
export const deliveryDueAt = (deliveryDate: string) => istMoment(deliveryDate, 18);

// ── Working-hours deadlines ──────────────────────────────────────────────────

export type WorkingDay = { isWorking: boolean; startHour: number; endHour: number };
/** Per weekday (0 = Monday). Used when the studio has not set its own hours. */
export const DEFAULT_SCHEDULE: Record<number, WorkingDay> = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { isWorking: d < 5, startHour: 10, endHour: 19 }]),
);

/**
 * When `slaHours` of working time from `start` runs out: only working hours on working days count, holidays are skipped, and time spent
 * waiting on the requester (`pausedSeconds`) is added on. Gives up (returning the last point reached) after a year with no working time.
 */
export function workingDue(start: Date, slaHours: number, schedule: Record<number, WorkingDay>, holidays: Set<string>, pausedSeconds = 0): Date {
  let remaining = slaHours * HOUR_MS + pausedSeconds * 1000;
  let t = +start;
  for (let guard = 0; remaining > 0 && guard < 400; guard++) {
    const day = istDate(t);
    const s = schedule[weekdayOf(day)];
    const nextDay = +istMoment(addDays(day, 1));
    if (!s || !s.isWorking || holidays.has(day) || s.endHour <= s.startHour) {
      t = nextDay;
      continue;
    }
    const open = +istMoment(day, s.startHour);
    const close = +istMoment(day, s.endHour);
    if (t < open) t = open;
    if (t >= close) {
      t = nextDay;
      continue;
    }
    const left = close - t;
    if (remaining <= left) return new Date(t + remaining);
    remaining -= left;
    t = nextDay;
  }
  return new Date(t);
}

/** Urgent work gets half the usual time (at least two hours). */
export const slaHoursFor = (typeSla: number, priority: Priority) => (priority === "urgent" ? Math.max(2, Math.floor(typeSla / 2)) : typeSla);

// ── Changes and revisions ────────────────────────────────────────────────────

export const CHANGE_CUTOFF_HOURS = 12;
export const REVIEW_TTL_HOURS = 48;
export const REVIEW_REMINDER_AFTER_HOURS = 24;
export const REVIEW_FILE_GRACE_DAYS = 7;
export const EXTRA_REVISION_TAG = "Extra revision";
export const LAST_MINUTE_TAG = "Last-Minute Change";

/**
 * Changes stop 12 hours before the event (from the start of the event day, IST). Without an event date the deadline is used instead, but
 * only until it passes: a design delivered late can still be corrected. Null: no cut-off.
 */
export function changeCutoff(t: { eventDate: string | null; dueAt: Date | null }, now = Date.now()): Date | null {
  if (t.eventDate) return new Date(+istMoment(t.eventDate) - CHANGE_CUTOFF_HOURS * HOUR_MS);
  if (!t.dueAt || now >= +t.dueAt) return null;
  return new Date(+t.dueAt - CHANGE_CUTOFF_HOURS * HOUR_MS);
}

/** The next version's number: DF-0007 → DF-0007-V2, DF-0007-V2 → DF-0007-V3. */
export const baseNumber = (n: string) => n.split("-V")[0];
export const versionNumber = (base: string, version: number) => (version <= 1 ? base : `${base}-V${version}`);
export const formatTicketNumber = (n: number) => `DF-${String(n).padStart(4, "0")}`;

/** Tags on a new version: past the free allowance it is an extra revision; under 12 hours from the deadline it is a last-minute change. */
export function revisionTags(parentTags: string[], nextVersion: number, maxFree: number, parentDue: Date | null, now = Date.now()): string[] {
  const tags = parentTags.filter((t) => t !== EXTRA_REVISION_TAG && t !== LAST_MINUTE_TAG);
  if (nextVersion - 1 > maxFree) tags.push(EXTRA_REVISION_TAG);
  if (parentDue && +parentDue - now < CHANGE_CUTOFF_HOURS * HOUR_MS) tags.push(LAST_MINUTE_TAG);
  return tags;
}

/** How a deadline looks: overdue, due within a day, or fine. */
export function dueHealth(dueAt: Date | string | null, status: TicketStatus, now = Date.now()): "overdue" | "soon" | "ok" | "done" | "none" {
  if (FINISHED_STATUSES.includes(status) || status === "superseded" || status === "declined") return "done";
  if (!dueAt) return "none";
  const ms = +new Date(dueAt) - now;
  if (ms < 0) return "overdue";
  if (ms <= 24 * HOUR_MS) return "soon";
  return "ok";
}

/** "3 days left", "5 hours left", "2 days late". */
export function timeLeft(dueAt: Date | string, now = Date.now()): string {
  const ms = +new Date(dueAt) - now;
  const abs = Math.abs(ms);
  const amount = abs >= DAY_MS ? `${Math.round(abs / DAY_MS)} day${Math.round(abs / DAY_MS) === 1 ? "" : "s"}` : `${Math.max(1, Math.round(abs / HOUR_MS))} hour${Math.max(1, Math.round(abs / HOUR_MS)) === 1 ? "" : "s"}`;
  return ms >= 0 ? `${amount} left` : `${amount} late`;
}

/** Only Slack's own incoming-webhook addresses are accepted, so the setting cannot be pointed anywhere else. */
export const isSlackWebhook = (url: string) => /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url.trim());

/** Figma file / design / proto links, for the embed. */
export function figmaEmbedUrl(url: string): string | null {
  const u = url.trim();
  if (!/^https:\/\/(www\.)?figma\.com\/(file|design|proto|board)\/[A-Za-z0-9]+/.test(u)) return null;
  return `https://www.figma.com/embed?embed_host=mccia-apphub&url=${encodeURIComponent(u)}`;
}
