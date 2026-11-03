/**
 * The All Tickets page's choices, as pure data (the page and its client parts share them): the status tabs, the sortable columns and
 * reading them from the address. The query itself is ticketListPage in admin-queries.ts.
 */

import type { Priority, TicketStatus } from "@/db/design-schema";
import { OPEN_STATUSES, PRIORITIES } from "./rules";

export const LIST_TABS = {
  all: { label: "All", statuses: null },
  pending: { label: "Pending Review", statuses: ["pending_review"] },
  active: { label: "Active", statuses: OPEN_STATUSES },
  in_review: { label: "In Review", statuses: ["in_review"] },
  delivered: { label: "Delivered", statuses: ["delivered"] },
  closed: { label: "Closed", statuses: ["closed", "closed_without_approval", "declined"] },
  overdue: { label: "Overdue", statuses: OPEN_STATUSES },
} satisfies Record<string, { label: string; statuses: TicketStatus[] | null }>;
export type ListTab = keyof typeof LIST_TABS;

export const LIST_SORTS = ["created", "number", "title", "priority", "status", "due"] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const PAGE_SIZE = 25;

export type ListQuery = {
  tab: ListTab;
  q: string;
  designer: string; // a person's id, "unassigned", or "" for anyone
  type: string;
  priority: Priority | "";
  from: string; // created on or after (IST day), "" for no limit
  to: string;
  sort: ListSort;
  dir: "asc" | "desc";
  page: number;
};

const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

/** The page's address, read safely: anything unknown falls back to the default (All, newest first, page 1). */
export function readListQuery(sp: Record<string, string | undefined>): ListQuery {
  const tab = (sp.filter && sp.filter in LIST_TABS ? sp.filter : "all") as ListTab;
  const sort = (LIST_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as ListSort) : "created";
  return {
    tab,
    q: (sp.q ?? "").slice(0, 100),
    designer: /^([0-9a-f-]{36}|unassigned)$/i.test(sp.designer ?? "") ? sp.designer! : "",
    type: /^[a-z0-9_-]{1,60}$/.test(sp.type ?? "") ? sp.type! : "",
    priority: PRIORITIES.includes(sp.priority as Priority) ? (sp.priority as Priority) : "",
    from: day(sp.from),
    to: day(sp.to),
    sort,
    dir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : sort === "created" ? "desc" : "asc",
    page: Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? "1", 10) || 1)),
  };
}

/** The address for a query, leaving out what is at its default. */
export function listHref(q: ListQuery, change: Partial<ListQuery> = {}): string {
  const n = { ...q, ...change };
  const p = new URLSearchParams();
  if (n.tab !== "all") p.set("filter", n.tab);
  if (n.q) p.set("q", n.q);
  if (n.designer) p.set("designer", n.designer);
  if (n.type) p.set("type", n.type);
  if (n.priority) p.set("priority", n.priority);
  if (n.from) p.set("from", n.from);
  if (n.to) p.set("to", n.to);
  if (n.sort !== "created" || n.dir !== "desc") {
    p.set("sort", n.sort);
    p.set("dir", n.dir);
  }
  if (n.page > 1) p.set("page", String(n.page));
  return `/design/admin/tickets${p.size ? `?${p}` : ""}`;
}
