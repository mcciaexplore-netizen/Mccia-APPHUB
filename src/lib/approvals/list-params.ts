import { z } from "zod";
import type { AprRequestStatus } from "@/db/approvals-schema";

/**
 * The list screens keep their state in the address (?q=, ?status=, ?page=...), so a filtered view can be bookmarked, shared and
 * exported. This file reads and writes that state; it has no server-only imports, so the client filter bar uses it too.
 */

const SORT_KEYS = ["requestNo", "name", "category", "branch", "amount", "requestedAt", "status", "approver", "decidedAt"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const STATUS_FILTERS = ["pending", "returned", "approved", "rejected", "withdrawn", "historical"] as const satisfies readonly AprRequestStatus[];

/** The Type filter of a mixed list: an approval type (see watching.ts). */
export const TYPE_FILTERS = ["hr", "expenditure", "budget"] as const;

export type ListParams = {
  q: string;
  from: string;
  to: string;
  status: string;
  categoryId: string;
  branchId: string;
  /** Lists that mix kinds of request (All Approvals): only HR, Expenditure or Budget. */
  type: string;
  /** All Approvals: only requests submitted by this person (their user id). */
  by: string;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
};

const DEFAULT_PARAMS: ListParams = { q: "", from: "", to: "", status: "", categoryId: "", branchId: "", type: "", by: "", sort: "requestedAt", dir: "desc", page: 1 };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Anything in the address that is not valid is quietly ignored, so a mangled link still opens the list. */
export function parseListParams(sp: Record<string, string | string[] | undefined>): ListParams {
  const sort = first(sp.sort);
  const status = first(sp.status);
  const page = Number.parseInt(first(sp.page), 10);
  return {
    q: first(sp.q).slice(0, 100),
    from: day.safeParse(first(sp.from)).success ? first(sp.from) : "",
    to: day.safeParse(first(sp.to)).success ? first(sp.to) : "",
    status: (STATUS_FILTERS as readonly string[]).includes(status) ? status : "",
    categoryId: uuid.safeParse(first(sp.categoryId)).success ? first(sp.categoryId) : "",
    branchId: uuid.safeParse(first(sp.branchId)).success ? first(sp.branchId) : "",
    type: (TYPE_FILTERS as readonly string[]).includes(first(sp.type)) ? first(sp.type) : "",
    by: uuid.safeParse(first(sp.by)).success ? first(sp.by) : "",
    sort: (SORT_KEYS as readonly string[]).includes(sort) ? (sort as SortKey) : DEFAULT_PARAMS.sort,
    dir: first(sp.dir) === "asc" ? "asc" : "desc",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 100_000) : 1, // a huge page number would overflow the database offset
  };
}

/** The query string for a state, leaving out everything that is still at its default. */
export function toQueryString(p: Partial<ListParams>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(p) as [keyof ListParams, string | number][]) {
    if (v === "" || v === DEFAULT_PARAMS[k]) continue;
    out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}
