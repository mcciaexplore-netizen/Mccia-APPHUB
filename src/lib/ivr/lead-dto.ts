import type { LeadRowDTO } from "@/components/ivr/leads/types";
import { formatPhone } from "./phone";
import { OUTCOMES } from "./outcome";
import { formatDuration, formatIst } from "./time";
import type { LeadRow } from "./leads";

export function toRowDTO(r: LeadRow): LeadRowDTO {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: formatPhone(r.phone),
    company: r.company,
    category: r.categoryLabel,
    stage: r.stage,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    attempts: r.attempts,
    lastOutcome: r.lastOutcome ? OUTCOMES[r.lastOutcome].label : null,
    lastCall:
      r.lastCallStatus && r.lastCallAt
        ? { status: r.lastCallStatus, when: formatIst(r.lastCallAt), duration: formatDuration(r.lastCallDuration) }
        : null,
    hasRecording: r.lastCallHasRecording,
  };
}
