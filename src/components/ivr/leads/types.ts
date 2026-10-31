import type { StageKey } from "@/lib/ivr/stage";

/** Row shape sent to client components. Dates are pre-formatted on the server so IST renders identically everywhere. */
export type LeadRowDTO = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  company: string | null;
  category: string | null;
  stage: StageKey;
  ownerId: string | null;
  ownerName: string | null;
  attempts: number;
  lastOutcome: string | null;
  lastCall: { status: string; when: string; duration: string } | null;
  hasRecording: boolean;
};

export type AgentOption = { id: string; name: string; open: number };
