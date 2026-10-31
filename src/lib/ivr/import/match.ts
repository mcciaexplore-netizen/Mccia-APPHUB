import { normalizePhone } from "@/lib/ivr/phone";

export type AgentEntry = {
  userId: string;
  name: string;
  email: string;
  phone: string | null; // E.164
  smartfloIds: string[];
  extensions: string[];
  /** Emails that Smartflo knows for this person (login ids). */
  sfEmails: string[];
};

export type AgentIndex = {
  agents: AgentEntry[];
  /** Email -> number of distinct people (CRM users + Smartflo agents) carrying it. */
  emailHolders: Map<string, number>;
};

export type MatchMethod = "agent_id" | "phone" | "email" | "email+name" | "name";
export type MatchStatus = "matched" | "ambiguous" | "unmatched";

export type MatchResult = {
  status: MatchStatus;
  userId: string | null;
  method: MatchMethod | null;
  candidates: { userId: string; name: string }[];
  note?: string;
};

export type AgentInput = { agentRef?: string; agentPhone?: string; agentEmail?: string; agentName?: string };

type UserIn = { id: string; name: string; email: string; phone: string | null; smartfloAgentId: string | null };
type SfIn = { id: string; name: string; number: string | null; extension: string | null; email: string | null; mappedUserId: string | null };

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildAgentIndex(users: UserIn[], sf: SfIn[]): AgentIndex {
  const byUser = new Map<string, AgentEntry>();
  for (const u of users) {
    byUser.set(u.id, {
      userId: u.id,
      name: u.name,
      email: lower(u.email),
      phone: normalizePhone(u.phone),
      smartfloIds: u.smartfloAgentId ? [u.smartfloAgentId.toLowerCase()] : [],
      extensions: [],
      sfEmails: [],
    });
  }
  const holders = new Map<string, Set<string>>();
  const hold = (email: string, who: string) => {
    if (!email) return;
    if (!holders.has(email)) holders.set(email, new Set());
    holders.get(email)!.add(who);
  };
  for (const u of users) hold(lower(u.email), `u:${u.id}`);
  for (const a of sf) {
    hold(lower(a.email), `s:${a.id}`);
    const entry = a.mappedUserId ? byUser.get(a.mappedUserId) : undefined;
    if (!entry) continue;
    if (!entry.smartfloIds.includes(a.id.toLowerCase())) entry.smartfloIds.push(a.id.toLowerCase());
    if (a.extension) entry.extensions.push(a.extension.toLowerCase());
    const n = normalizePhone(a.number);
    if (n && !entry.phone) entry.phone = n;
    if (a.email) entry.sfEmails.push(lower(a.email));
  }
  // A CRM user and their own Smartflo agent count as one holder of the same email.
  const emailHolders = new Map<string, number>();
  for (const [email, set] of holders) {
    const people = new Set<string>();
    for (const w of set) {
      if (w.startsWith("u:")) people.add(w);
      else {
        const agent = sf.find((a) => `s:${a.id}` === w);
        people.add(agent?.mappedUserId ? `u:${agent.mappedUserId}` : w);
      }
    }
    emailHolders.set(email, people.size);
  }
  return { agents: [...byUser.values()], emailHolders };
}

const cand = (a: AgentEntry) => ({ userId: a.userId, name: a.name });
const matched = (a: AgentEntry, method: MatchMethod, note?: string): MatchResult => ({
  status: "matched",
  userId: a.userId,
  method,
  candidates: [cand(a)],
  note,
});
const ambiguous = (list: AgentEntry[], note: string): MatchResult => ({
  status: "ambiguous",
  userId: null,
  method: null,
  candidates: list.map(cand),
  note,
});
const unmatched = (note: string): MatchResult => ({ status: "unmatched", userId: null, method: null, candidates: [], note });

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Candidates whose name fits the text: exact, then first-name/last-name token, then small edit distance. */
export function matchByName(pool: AgentEntry[], text: string): AgentEntry[] {
  const key = nameKey(text);
  if (!key) return [];
  const exact = pool.filter((a) => nameKey(a.name) === key);
  if (exact.length) return exact;
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length) {
    const byToken = pool.filter((a) => {
      const parts = a.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return tokens.every((t) => parts.includes(t));
    });
    if (byToken.length) return byToken;
  }
  const limit = Math.max(1, Math.ceil(key.length * 0.15));
  let best = Infinity;
  let hits: AgentEntry[] = [];
  for (const a of pool) {
    const d = levenshtein(key, nameKey(a.name));
    if (d > limit) continue;
    if (d < best) {
      best = d;
      hits = [a];
    } else if (d === best) hits.push(a);
  }
  return hits;
}

function byEmail(index: AgentIndex, email: string): AgentEntry[] {
  return index.agents.filter((a) => a.email === email || a.sfEmails.includes(email));
}

/** Matching order: agent id/extension, agent phone, agent email, agent name. Shared emails are never guessed. */
export function matchAgent(index: AgentIndex, input: AgentInput): MatchResult {
  const ref = lower(input.agentRef);
  let phoneText = (input.agentPhone ?? "").trim();
  let emailText = lower(input.agentEmail);
  let nameText = (input.agentName ?? "").trim();

  // An "assigned to" column often holds an email or a number even when mapped as a name.
  if (nameText && EMAIL_RE.test(nameText)) {
    if (!emailText) emailText = lower(nameText);
    nameText = "";
  } else if (nameText && /^[+()\d\s.-]{8,}$/.test(nameText) && normalizePhone(nameText)) {
    if (!phoneText) phoneText = nameText;
    nameText = "";
  }
  if (!ref && !phoneText && !emailText && !nameText) return unmatched("No agent given");

  // 1. Smartflo agent id or extension
  if (ref) {
    const hits = index.agents.filter((a) => a.smartfloIds.includes(ref) || a.extensions.includes(ref));
    if (hits.length === 1) return matched(hits[0], "agent_id");
    if (hits.length > 1) return ambiguous(hits, `Agent ID ${input.agentRef} belongs to several agents`);
  }

  // 2. Agent phone
  const phone = normalizePhone(phoneText);
  if (phone) {
    const hits = index.agents.filter((a) => a.phone === phone);
    if (hits.length === 1) return matched(hits[0], "phone");
    if (hits.length > 1) return ambiguous(hits, "Phone number belongs to several agents");
  }

  // 3. Agent email, with name or phone from the same row to settle shared emails
  if (emailText) {
    const hits = byEmail(index, emailText);
    const shared = (index.emailHolders.get(emailText) ?? 0) > 1;
    if (hits.length >= 1) {
      let narrowed = hits;
      let settled = !shared && hits.length === 1;
      if (phone) {
        const p = narrowed.filter((a) => a.phone === phone);
        if (p.length) {
          narrowed = p;
          if (p.length === 1) settled = true;
        }
      }
      if (!settled && nameText) {
        const n = matchByName(narrowed, nameText);
        if (n.length) {
          narrowed = n;
          if (n.length === 1) settled = true;
        }
      }
      if (settled && narrowed.length === 1) {
        return matched(narrowed[0], shared ? "email+name" : "email", shared ? "Email is shared; the row's name or phone settled it" : undefined);
      }
      return ambiguous(narrowed, shared ? "This email is shared by more than one agent. Pick the right one." : "Several agents match this email");
    }
    // Email known to nobody: fall back to the name if there is one.
    if (!nameText) return unmatched(`No agent has the email ${emailText}`);
  }

  // 4. Agent name
  if (nameText) {
    const hits = matchByName(index.agents, nameText);
    if (hits.length === 1) return matched(hits[0], "name");
    if (hits.length > 1) return ambiguous(hits, `"${nameText}" fits more than one agent`);
    return unmatched(`No agent named "${nameText}"`);
  }
  return unmatched("Agent not found");
}
