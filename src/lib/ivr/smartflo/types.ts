export type SfCallStatus = "answered" | "missed" | "ongoing" | "unknown";

export type SfAgent = {
  id: string;
  name: string;
  number: string | null;
  extension: string | null;
  loginId: string | null;
};

/** One call in our own shape, whether it came from the CDR API, a webhook or the mock. */
export type SfCall = {
  callId: string;
  direction: "inbound" | "outbound";
  status: SfCallStatus;
  customerNumber: string;
  didNumber: string | null;
  agentId: string | null;
  agentName: string | null;
  agentNumber: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number;
  answeredSec: number;
  recordingUrl: string | null;
  dtmf: string | null;
  disposition: string | null;
  hangupCause: string | null;
  refId: string | null;
  /** The `custom_identifier` we sent with a Call-button request, echoed back by Smartflo (dial request id). */
  dialRequestId: string | null;
  callFlow: unknown[] | null;
  raw: Record<string, unknown>;
};

export type SfLiveCall = {
  callId: string;
  direction: "inbound" | "outbound";
  customerNumber: string;
  agentName: string | null;
  agentNumber: string | null;
  state: string;
  startedAt: Date | null;
};

export type ClickToCallInput = {
  apiKey: string;
  customerNumber: string;
  customIdentifier?: Record<string, string>;
  callerId?: string;
};

/** Smartflo "Click to Call": rings the agent first, then connects the member. Authenticated with the org token. */
export type AgentCallInput = {
  agentNumber: string;
  destinationNumber: string;
  callerId?: string;
  /** Sent back on the call's webhook so the call can be matched to the request. */
  customIdentifier?: Record<string, string>;
};

export interface SmartfloProvider {
  readonly mode: "live" | "mock";
  testConnection(): Promise<{ ok: true; agents: number; note?: string } | { ok: false; error: string }>;
  listAgents(): Promise<SfAgent[]>;
  listCalls(range: { from: Date; to: Date }): Promise<SfCall[]>;
  liveCalls(): Promise<SfLiveCall[]>;
  /** Legacy "Click to Call Support" (per-agent key, rings the customer first). Kept as a fallback. */
  clickToCall(input: ClickToCallInput): Promise<{ refId: string }>;
  clickToCallAgent(input: AgentCallInput): Promise<{ refId: string; message?: string }>;
}

export class SmartfloError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
