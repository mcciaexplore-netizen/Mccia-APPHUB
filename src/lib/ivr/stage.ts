import type { Outcome } from "@/db/ivr-schema";

export type StageKey = "new" | "attempted" | "connected" | "closed";

export const STAGES: Record<StageKey, { label: string; color: string; hint: string }> = {
  new: { label: "New", color: "var(--ivr-incoming)", hint: "Not called yet" },
  attempted: { label: "Attempted", color: "var(--ivr-attempted)", hint: "Called, not answered" },
  connected: { label: "Connected", color: "var(--ivr-done)", hint: "Spoke to the member" },
  closed: { label: "Closed", color: "var(--ivr-muted)", hint: "Nothing more to do" },
};

export const STAGE_ORDER: StageKey[] = ["new", "attempted", "connected", "closed"];

/** Stages that still need a call from an agent. */
export const OPEN_STAGES: StageKey[] = ["new", "attempted"];

export function isStage(v: unknown): v is StageKey {
  return typeof v === "string" && v in STAGES;
}

/**
 * How a call moves a lead between stages. Only applied for calls newer than the lead's last call.
 * Answered calls connect the lead, unanswered outbound calls mark it attempted, and an unanswered inbound call
 * changes nothing (it needs a call back, which is a queue concern, not a stage). Closed stays closed.
 */
export function nextStage(current: StageKey, c: { outcome: Outcome | null; direction: string }): StageKey {
  if (current === "closed") return current;
  if (c.outcome === "answered") return "connected";
  if (c.direction === "outbound" && current === "new") return "attempted";
  return current;
}
