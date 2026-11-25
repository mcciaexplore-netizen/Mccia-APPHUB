/**
 * Per-item deliverables, as pure functions (no database, no server code) so the pages, the server and the unit tests share one copy.
 *
 * A ticket made from the request form with per_item on has one deliverable for each design asked for (Flyer, WhatsApp creative ...). The
 * designer uploads a proof for one deliverable at a time and sends it for review; the requester approves it or asks for changes, per item.
 * An item's state is never stored: it is read from its proofs and their review links, so it cannot drift from what actually happened.
 * The ticket is Delivered once every item is approved, and Closed only when the requester closes it.
 */
import type { ApprovalStatus } from "@/db/design-schema";

export type ItemState = "not_started" | "uploaded" | "in_review" | "changes_requested" | "approved";

export const ITEM_STATE_LABEL: Record<ItemState, string> = {
  not_started: "Not started",
  uploaded: "Uploaded, not sent",
  in_review: "Waiting for approval",
  changes_requested: "Changes requested",
  approved: "Approved",
};

export const ITEM_STATE_TONE: Record<ItemState, "neutral" | "blue" | "amber" | "purple" | "green"> = {
  not_started: "neutral",
  uploaded: "blue",
  in_review: "purple",
  changes_requested: "amber",
  approved: "green",
};

type ProofLite = { id: string; itemKey: string | null; version: number };
type RequestLite = { proofVersionId: string; status: ApprovalStatus; expiresAt: Date; createdAt: Date };

/** A pending link past its expiry counts as expired, before the scheduled job gets to it. */
export const effectiveStatus = (r: { status: ApprovalStatus; expiresAt: Date }): ApprovalStatus => (r.status === "pending" && +r.expiresAt < Date.now() ? "expired" : r.status);

/**
 * One item's state from its proofs and their review links:
 *   approved           any of its proofs was approved
 *   in_review          its newest link is still open
 *   changes_requested  its newest link asked for changes and no newer proof has been uploaded since
 *   uploaded           it has a proof, but nothing waiting (never sent, withdrawn, expired, or a new proof after a change request)
 *   not_started        no proof yet
 */
export function itemState(key: string, proofs: ProofLite[], requests: RequestLite[]): ItemState {
  const mine = proofs.filter((p) => p.itemKey === key);
  if (!mine.length) return "not_started";
  const versionOf = new Map(mine.map((p) => [p.id, p.version]));
  const reqs = requests.filter((r) => versionOf.has(r.proofVersionId));
  if (reqs.some((r) => r.status === "approved")) return "approved";
  const last = [...reqs].sort((a, b) => +b.createdAt - +a.createdAt)[0];
  if (!last) return "uploaded";
  const s = effectiveStatus(last);
  if (s === "pending") return "in_review";
  if (s === "changes_requested") {
    const newest = Math.max(...mine.map((p) => p.version));
    return newest > (versionOf.get(last.proofVersionId) ?? 0) ? "uploaded" : "changes_requested";
  }
  return "uploaded";
}

export function itemStates(keys: string[], proofs: ProofLite[], requests: RequestLite[]): Map<string, ItemState> {
  return new Map(keys.map((k) => [k, itemState(k, proofs, requests)]));
}

export type Progress = { done: number; total: number };

export const progressOf = (states: Iterable<ItemState>): Progress => {
  const all = [...states];
  return { done: all.filter((s) => s === "approved").length, total: all.length };
};

/** "1 / 3 completed", and "3 / 3 completed → Ready to close" once all are approved. */
export const progressLabel = (p: Progress): string => `${p.done} / ${p.total} completed${p.total > 0 && p.done === p.total ? " → Ready to close" : ""}`;

/**
 * Where the ticket goes after an item's review is decided: Delivered when every item is approved; still In review while another item
 * waits for the requester; otherwise back to In progress, for the designer.
 */
export function statusAfterDecision(states: Map<string, ItemState>): "delivered" | "in_review" | "in_progress" {
  const all = [...states.values()];
  if (all.length > 0 && all.every((s) => s === "approved")) return "delivered";
  if (all.some((s) => s === "in_review")) return "in_review";
  return "in_progress";
}
