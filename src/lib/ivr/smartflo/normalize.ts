import type { SfAgent, SfCall, SfCallStatus, SfLiveCall } from "./types";

type Rec = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const int = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) ? n : 0;
};

/** Smartflo timestamps are "YYYY-MM-DD HH:mm:ss" in IST unless the webhook was set to ISO/epoch/UTC. */
export function parseSfTime(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d{9,13}$/.test(s)) return new Date(s.length <= 10 ? Number(s) * 1000 : Number(s));
  if (/[TZ]|[+-]\d{2}:?\d{2}$/.test(s) && /\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) {
    const d = new Date(`${m[1]}T${m[2]}+05:30`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Webhook templates are documented as `$call_id`; the live payload may or may not keep the `$`. */
function stripDollar(p: Rec): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(p)) out[k.startsWith("$") ? k.slice(1) : k] = v;
  return out;
}

function statusOf(v: unknown, answeredSec = 0): SfCallStatus {
  const s = (str(v) ?? "").toLowerCase();
  if (s === "c" || s.includes("answer") || s.includes("connect")) return "answered";
  if (s === "m" || s.includes("miss") || s.includes("no answer") || s.includes("noanswer")) return "missed";
  if (s.includes("ongoing") || s.includes("progress") || s.includes("live")) return "ongoing";
  return answeredSec > 0 ? "answered" : "unknown";
}

function directionOf(v: unknown): "inbound" | "outbound" {
  const s = (str(v) ?? "").toLowerCase();
  if (s === "2" || s.includes("out") || s.includes("c2c") || s.includes("click")) return "outbound";
  return "inbound";
}

/** Smartflo echoes our `custom_identifier` back as an object or a JSON string; we put the dial request id in `dr`. */
function dialRequestIdOf(v: unknown): string | null {
  let o: unknown = v;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const id = str((o as Rec).dr);
  if (!id || !/^[0-9a-f-]{32,36}$/i.test(id)) return null;
  // The Call button sends the request id without dashes (identifiers must be alphanumeric); the database stores it with dashes.
  return id.length === 32 ? id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5").toLowerCase() : id.toLowerCase();
}

/** Record from GET /v1/call/records. */
export function normalizeCdr(r: Rec): SfCall | null {
  const callId = str(r.call_id) ?? str(r.id);
  const customer = str(r.client_number) ?? str((r.contact_details as Rec | undefined)?.number);
  const started = parseSfTime(`${str(r.date) ?? ""} ${str(r.time) ?? ""}`.trim()) ?? parseSfTime(r.start_stamp);
  if (!callId || !customer || !started) return null;
  const answeredSec = int(r.answered_seconds);
  const dialer = (r.dialer_call_details as Rec | undefined) ?? {};
  return {
    callId,
    direction: directionOf(r.direction),
    status: statusOf(r.status, answeredSec),
    customerNumber: customer,
    didNumber: str(r.did_number),
    agentId: null,
    agentName: str(r.agent_name),
    agentNumber: str(r.agent_number_with_prefix) ?? str(r.agent_number),
    startedAt: started,
    endedAt: parseSfTime(r.end_stamp),
    durationSec: int(r.call_duration),
    answeredSec,
    recordingUrl: str(r.recording_url),
    dtmf: str(r.dtmf_input),
    disposition: str(dialer.disposition_name) ?? str(r.custom_status),
    hangupCause: str(r.hangup_cause),
    refId: str(r.ref_id) ?? str(r.uuid),
    dialRequestId: dialRequestIdOf(r.custom_identifier),
    callFlow: Array.isArray(r.call_flow) ? (r.call_flow as unknown[]) : null,
    raw: r,
  };
}

const has = (p: Rec, k: string) => p[k] !== undefined && p[k] !== null && String(p[k]).trim() !== "";

/**
 * What a webhook was about, for the event log (ivr_call_events.trigger). Smartflo sends two: "received" while the call rings or is in
 * progress, and "hangup" once it has ended. The name is read from a field when a template adds one; otherwise a payload with an end time,
 * a hang-up cause or talk time (billsec above 0) is a hang-up and anything else is "received" (a ringing call carries billsec 0).
 */
export function webhookEvent(payload: Rec): string {
  const p = stripDollar(payload);
  const named = str(p.trigger) ?? str(p.event) ?? str(p.event_type) ?? str(p.call_event);
  if (named) return named;
  if (parseSfTime(p.end_stamp) || has(p, "hangup_cause") || int(p.billsec) > 0) return "hangup";
  return "received";
}

/** A hang-up event, by whatever name the template gave it; everything else ("received", "answered", "ringing" ...) is a call still going. */
const isHangup = (event: string) => /hang|end|complet|disconnect/i.test(event);

/**
 * Webhook payload. Returns null only when there is no call id or no caller's number (the event is still stored, not merged). The start
 * time is `start_stamp` (or `start_date` + `start_time`); failing those, the answer time, or the end time less the call's length, and as a
 * last resort the moment it arrived less its length, so a hang-up webhook without a start time still becomes a call.
 *
 * Status: a "received" webhook is always "ongoing", never missed. A "hangup" is "answered" when billsec (talk time) is above 0, else "missed".
 */
export function normalizeWebhook(payload: Rec, receivedAt: Date = new Date()): SfCall | null {
  const p = stripDollar(payload);
  const callId = str(p.call_id);
  const direction = directionOf(p.direction);
  // Real inbound payloads carry the caller in caller_id_number and leave customer_number empty. On an outbound call caller_id_number is
  // the number Smartflo showed the member (our own line), so there the customer fields come first. ingest.ts adds +91 to a bare 10 digits.
  const customerFields = [str(p.customer_number_with_prefix), str(p.customer_no_with_prefix), str(p.customer_number)];
  const customer =
    direction === "inbound"
      ? str(p.caller_id_number) ?? customerFields.find(Boolean) ?? null
      : customerFields.find(Boolean) ?? str(p.caller_id_number);
  if (!callId || !customer) return null;
  const answeredSec = int(p.billsec);
  const durationSec = int(p.duration) || answeredSec;
  const ended = parseSfTime(p.end_stamp);
  const back = (from: Date) => new Date(from.getTime() - durationSec * 1000);
  const started =
    parseSfTime(p.start_stamp) ??
    parseSfTime(`${str(p.start_date) ?? ""} ${str(p.start_time) ?? ""}`.trim()) ??
    parseSfTime(p.answer_stamp) ??
    (ended ? back(ended) : back(receivedAt));
  const answeredAgent = (p.answered_agent as Rec | undefined) ?? undefined;
  const digits = Array.isArray(p.digits_dialed) ? (p.digits_dialed as unknown[]).join("") : str(p.digits_dialed);
  return {
    callId,
    direction,
    status: !isHangup(webhookEvent(payload)) ? "ongoing" : answeredSec > 0 ? "answered" : "missed",
    customerNumber: customer,
    // Often empty in real payloads; the Membership filter then goes by the agent who took the call.
    didNumber: str(p.call_to_number) ?? str(p.did_number),
    agentId: str(answeredAgent?.id),
    agentName: str(p.answered_agent_name) ?? str(answeredAgent?.name) ?? str(p.agent_name),
    agentNumber:
      str(p.answered_agent_number) ?? str(p.answer_agent_number) ?? str(answeredAgent?.number) ?? str(p.agent_number),
    startedAt: started,
    endedAt: ended,
    durationSec,
    answeredSec,
    recordingUrl: str(p.recording_url),
    dtmf: digits,
    disposition: str(p.disposition),
    hangupCause: str(p.hangup_cause),
    refId: str(p.ref_id),
    dialRequestId: dialRequestIdOf(p.custom_identifier),
    callFlow: Array.isArray(p.call_flow) ? (p.call_flow as unknown[]) : null,
    raw: payload,
  };
}

/** Item of GET /v1/users. */
export function normalizeUserAsAgent(u: Rec): SfAgent | null {
  const agent = u.agent as Rec | undefined;
  const id = str(agent?.id);
  if (!id) return null;
  return {
    id,
    name: str(agent?.name) ?? str(u.name) ?? id,
    number: str(agent?.follow_me_number),
    extension: str(u.extension),
    loginId: str(u.login_id),
  };
}

/** Item of GET /v1/live_calls. */
export function normalizeLive(r: Rec): SfLiveCall | null {
  const callId = str(r.call_id);
  const customer = str(r.customer_number) ?? str(r.destination) ?? str(r.source);
  if (!callId || !customer) return null;
  return {
    callId,
    direction: int(r.direction) === 2 ? "outbound" : "inbound",
    customerNumber: customer,
    agentName: str(r.agent_name),
    agentNumber: str(r.source) && int(r.direction) === 2 ? str(r.source) : str(r.destination),
    state: str(r.state) ?? "ongoing",
    startedAt: parseSfTime(r.created_at),
  };
}
