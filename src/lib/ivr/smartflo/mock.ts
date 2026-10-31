import "server-only";
import type { AgentCallInput, ClickToCallInput, SfAgent, SfCall, SfLiveCall, SmartfloProvider } from "./types";

// Fictional agents and customers. Used when SMARTFLO_MODE=mock so the whole app can be exercised without credentials.
export const MOCK_AGENTS: SfAgent[] = [
  { id: "mock-a1", name: "Asha Kulkarni", number: "+919000000101", extension: "101", loginId: "asha@demo.local" },
  { id: "mock-a2", name: "Rohit Deshmukh", number: "+919000000102", extension: "102", loginId: "rohit@demo.local" },
  { id: "mock-a3", name: "Sneha Patil", number: "+919000000103", extension: "103", loginId: "sneha@demo.local" },
  { id: "mock-a4", name: "Vikram Joshi", number: "+919000000104", extension: "104", loginId: "vikram@demo.local" },
  { id: "mock-a5", name: "Pooja Naik", number: "+919000000105", extension: "105", loginId: "pooja@demo.local" },
  { id: "mock-a6", name: "Imran Shaikh", number: "+919000000106", extension: "106", loginId: "imran@demo.local" },
];

export const MOCK_CUSTOMERS = Array.from({ length: 80 }, (_, i) => `+9190000${String(20000 + i)}`);
export const MOCK_DID = "+912071000000";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

const DAY = 86_400_000;
const IST = 5.5 * 3600_000;

function dayStartIst(ms: number): number {
  return Math.floor((ms + IST) / DAY) * DAY - IST;
}

/** Some members never pick up, others usually do, and late morning and late afternoon work best. */
function pickupChance(customerIndex: number, hour: number): number {
  if (customerIndex % 7 === 0) return 0.04;
  const base = 0.35 + ((customerIndex * 13) % 45) / 100;
  const hourBoost = (hour >= 11 && hour <= 13) || (hour >= 16 && hour <= 18) ? 0.15 : hour < 10 ? -0.1 : 0;
  return Math.min(0.92, Math.max(0.05, base + hourBoost));
}

const MISS_CAUSES = ["NO_ANSWER", "NO_ANSWER", "NO_ANSWER", "USER_BUSY", "UNREACHABLE"];

// Membership work is mostly outbound; a small share of inbound shows the direction split.
function callsForDay(dayStart: number): SfCall[] {
  const dayIdx = Math.floor((dayStart + IST) / DAY);
  const dow = new Date(dayStart + IST).getUTCDay();
  const out: SfCall[] = [];
  MOCK_AGENTS.forEach((agent, ai) => {
    const r = rng(dayIdx * 97 + ai * 13 + 7);
    const weekend = dow === 0 || dow === 6;
    const n = weekend ? Math.floor(r() * 3) : 10 + Math.floor(r() * 10);
    for (let k = 0; k < n; k++) {
      const minute = 9 * 60 + 30 + Math.floor(r() * 510);
      const startedMs = dayStart + minute * 60_000;
      const hour = Math.floor(minute / 60);
      const inbound = r() < 0.12;
      const ci = Math.floor(r() * MOCK_CUSTOMERS.length);
      const customer = MOCK_CUSTOMERS[ci];
      const answered = inbound ? r() > 0.2 : r() < pickupChance(ci, hour);
      const answeredSec = answered ? 25 + Math.floor(r() * (inbound ? 240 : 330)) : 0;
      const ring = 8 + Math.floor(r() * 14);
      const id = `mock-${dayIdx}-${ai}-${k}`;
      out.push({
        callId: id,
        direction: inbound ? "inbound" : "outbound",
        status: answered ? "answered" : "missed",
        customerNumber: customer,
        didNumber: MOCK_DID,
        agentId: agent.id,
        agentName: agent.name,
        agentNumber: agent.number,
        startedAt: new Date(startedMs),
        endedAt: new Date(startedMs + (ring + answeredSec) * 1000),
        durationSec: ring + answeredSec,
        answeredSec,
        recordingUrl: answered ? `mock://recording/${id}` : null,
        dtmf: inbound ? String(1 + Math.floor(r() * 5)) : null,
        disposition: null,
        hangupCause: answered ? "NORMAL_CLEARING" : MISS_CAUSES[Math.floor(r() * MISS_CAUSES.length)],
        refId: null,
        dialRequestId: null,
        callFlow: inbound ? [{ type: "ivr", name: "Main menu" }, { type: "agent", name: agent.name }] : null,
        raw: { mock: true },
      });
    }
  });
  return out;
}

export class MockSmartflo implements SmartfloProvider {
  readonly mode = "mock" as const;

  async testConnection() {
    return { ok: true as const, agents: MOCK_AGENTS.length };
  }

  async listAgents() {
    return MOCK_AGENTS;
  }

  async listCalls({ from, to }: { from: Date; to: Date }): Promise<SfCall[]> {
    const now = Date.now();
    const out: SfCall[] = [];
    for (let d = dayStartIst(from.getTime()); d < to.getTime(); d += DAY) {
      for (const c of callsForDay(d)) {
        if (c.startedAt >= from && c.startedAt < to && c.startedAt.getTime() <= now) out.push(c);
      }
    }
    return out;
  }

  async liveCalls(): Promise<SfLiveCall[]> {
    const minute = Math.floor(Date.now() / 60_000);
    const r = rng(minute);
    const n = Math.floor(r() * 4);
    const out: SfLiveCall[] = [];
    for (let i = 0; i < n; i++) {
      const agent = MOCK_AGENTS[Math.floor(r() * MOCK_AGENTS.length)];
      out.push({
        callId: `mock-live-${minute}-${i}`,
        direction: r() < 0.15 ? "inbound" : "outbound",
        customerNumber: MOCK_CUSTOMERS[Math.floor(r() * MOCK_CUSTOMERS.length)],
        agentName: agent.name,
        agentNumber: agent.number,
        state: "answered",
        startedAt: new Date(minute * 60_000 + Math.floor(r() * 50_000)),
      });
    }
    return out;
  }

  async clickToCall(_input: ClickToCallInput) {
    void _input;
    return { refId: `mock-ref-${Date.now()}` };
  }

  async clickToCallAgent(_input: AgentCallInput) {
    void _input;
    return { refId: `mock-ref-${Date.now()}` };
  }
}
