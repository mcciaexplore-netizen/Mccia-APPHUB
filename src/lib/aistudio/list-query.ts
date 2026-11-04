/**
 * The All Requests page's choices, as pure data (the page and its client parts share them): the status tabs, the filters, the sortable
 * columns, card or list view, and reading and writing them in the address, so a filtered view can be shared as a link.
 */

import type { Priority, RequestStatus, RequestType } from "@/db/aistudio-schema";
import { PRIORITIES, REQUEST_TYPES } from "./aistudio.manifest";

export const LIST_TABS = {
  all: { label: "All", statuses: null },
  pending: { label: "Pending", statuses: ["pending_review"] },
  accepted: { label: "Accepted", statuses: ["accepted"] },
  in_progress: { label: "In Progress", statuses: ["in_progress"] },
  review_testing: { label: "Review/Testing", statuses: ["review_testing"] },
  delivered: { label: "Delivered", statuses: ["delivered", "closed"] },
  declined: { label: "Declined", statuses: ["declined"] },
} satisfies Record<string, { label: string; statuses: RequestStatus[] | null }>;
export type ListTab = keyof typeof LIST_TABS;

export const LIST_SORTS = ["submitted", "number", "title", "type", "requester", "assignee", "priority", "status", "deadline"] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const PAGE_SIZE = 25;

export type ListQuery = {
  view: "cards" | "list";
  tab: ListTab;
  q: string;
  type: RequestType | "";
  priority: Priority | "";
  assignee: string; // a person's id, "unassigned", or "" for anyone
  sort: ListSort;
  dir: "asc" | "desc";
  page: number;
};

/** The address, read safely: anything unknown falls back to the default (cards, All, newest first, page 1). */
export function readListQuery(sp: Record<string, string | undefined>): ListQuery {
  const sort = (LIST_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as ListSort) : "submitted";
  return {
    view: sp.view === "list" ? "list" : "cards",
    tab: (sp.filter && sp.filter in LIST_TABS ? sp.filter : "all") as ListTab,
    q: (sp.q ?? "").slice(0, 100),
    type: REQUEST_TYPES.includes(sp.type as RequestType) ? (sp.type as RequestType) : "",
    priority: PRIORITIES.includes(sp.priority as Priority) ? (sp.priority as Priority) : "",
    assignee: /^([0-9a-f-]{36}|unassigned)$/i.test(sp.assignee ?? "") ? sp.assignee! : "",
    sort,
    dir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : sort === "submitted" ? "desc" : "asc",
    page: Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? "1", 10) || 1)),
  };
}

/** The address for a query, leaving out what is at its default. */
export function listHref(q: ListQuery, change: Partial<ListQuery> = {}): string {
  const n = { ...q, ...change };
  const p = new URLSearchParams();
  if (n.view === "list") p.set("view", "list");
  if (n.tab !== "all") p.set("filter", n.tab);
  if (n.q) p.set("q", n.q);
  if (n.type) p.set("type", n.type);
  if (n.priority) p.set("priority", n.priority);
  if (n.assignee) p.set("assignee", n.assignee);
  if (n.sort !== "submitted" || n.dir !== "desc") {
    p.set("sort", n.sort);
    p.set("dir", n.dir);
  }
  if (n.page > 1) p.set("page", String(n.page));
  return `/aistudio/admin/requests${p.size ? `?${p}` : ""}`;
}
