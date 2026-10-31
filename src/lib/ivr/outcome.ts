import type { Outcome } from "@/db/ivr-schema";

export const OUTCOMES: Record<Outcome, { label: string; answered: boolean }> = {
  answered: { label: "Answered", answered: true },
  not_answered: { label: "Not answered", answered: false },
  busy: { label: "Busy", answered: false },
  switched_off: { label: "Switched off / unreachable", answered: false },
  invalid: { label: "Invalid number", answered: false },
  failed: { label: "Failed", answered: false },
};

export function isOutcome(v: unknown): v is Outcome {
  return typeof v === "string" && v in OUTCOMES;
}

/**
 * Work out what happened to a call from Smartflo's status and hangup cause.
 * The cause names are FreeSWITCH-style and this mapping is a first guess: check it against real Smartflo data.
 */
export function deriveOutcome(status: string, hangupCause: string | null | undefined, answeredSec: number): Outcome | null {
  if (status === "ongoing") return null;
  if (status === "answered" || answeredSec > 0) return "answered";
  const cause = (hangupCause ?? "").toUpperCase();
  if (cause.includes("BUSY")) return "busy";
  if (/UNALLOCATED|INVALID_NUMBER|NO_ROUTE|NUMBER_CHANGED|INCOMPATIBLE/.test(cause)) return "invalid";
  if (/UNREACHABLE|SUBSCRIBER_ABSENT|NO_USER_RESPONSE|OUT_OF_ORDER|SWITCHED_OFF/.test(cause)) return "switched_off";
  if (/FAIL|CONGESTION|TEMPORARY|DESTINATION|NETWORK|ERROR/.test(cause)) return "failed";
  return "not_answered";
}
