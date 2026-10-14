import { z } from "zod";
import type { AprRequestStatus } from "@/db/approvals-schema";

/**
 * The list screens keep their state in the address (?q=, ?status=, ?page=...), so a filtered view can be bookmarked, shared and
 * exported. This file reads and writes that state; it has no server-only imports, so the client filter bar uses it too.
 */

export const SORT_KEYS = ["requestNo", "name", "category", "branch", "amount", "requestedAt", "status", "approver", "decidedAt"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const STATUS_FILTERS = ["pending", "approved", "rejected", "withdrawn"] as const satisfies readonly AprRequestStatus[];

export type ListParams = {
  q: string;
  from: string;
  to: string;
  status: string;
  categoryId: string;
  branchId: string;
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
};

export const DEFAULT_PARAMS: ListParams = { q: "", from: "", to: "", status: "", categoryId: "", branchId: "", sort: "requestedAt", dir: "desc", page: 1 };

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
    sort: (SORT_KEYS as readonly string[]).includes(sort) ? (sort as SortKey) : DEFAULT_PARAMS.sort,
    dir: first(sp.dir) === "asc" ? "asc" : "desc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
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
