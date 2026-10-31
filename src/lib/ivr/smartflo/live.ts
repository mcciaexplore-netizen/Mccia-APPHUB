import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { integrations } from "@/db/ivr-schema";
import { decryptJson, encryptJson } from "@/lib/ivr/crypto";
import { env } from "@/lib/ivr/env";
import { toIstDateString } from "@/lib/ivr/time";
import { normalizeCdr, normalizeLive, normalizeUserAsAgent } from "./normalize";
import {
  SmartfloError,
  type AgentCallInput,
  type ClickToCallInput,
  type SfAgent,
  type SfCall,
  type SfLiveCall,
  type SmartfloProvider,
} from "./types";

export type SmartfloCredentials = { email: string; password: string } | { token: string };

type Rec = Record<string, unknown>;
type Auth = { token: string; exp: number; bearer: boolean };
const tokenCache = new Map<string, Auth>();

// Smartflo limits logins per account (429 "Too many login attempts"). Serverless instances each start with an empty memory,
// so the token is also kept (encrypted) on the integration row and shared by every instance.
async function loadStoredAuth(key: string): Promise<Auth | null> {
  if (key === "test") return null;
  try {
    const [row] = await db.select({ meta: integrations.meta }).from(integrations).where(eq(integrations.id, key)).limit(1);
    const enc = row?.meta?.sfToken;
    return typeof enc === "string" ? decryptJson<Auth>(enc) : null;
  } catch {
    return null;
  }
}

async function storeAuth(key: string, auth: Auth): Promise<void> {
  tokenCache.set(key, auth);
  if (key === "test") return;
  try {
    const patch = JSON.stringify({ sfToken: encryptJson(auth) });
    await db
      .update(integrations)
      .set({ meta: sql`${integrations.meta} || ${patch}::jsonb` })
      .where(eq(integrations.id, key));
  } catch {
    // Sharing the token is an optimisation; the in-memory copy still works.
  }
}

function istStamp(d: Date): string {
  const t = new Date(d.getTime() + 5.5 * 3600_000).toISOString();
  return `${toIstDateString(d)} ${t.slice(11, 19)}`;
}

export class LiveSmartflo implements SmartfloProvider {
  readonly mode = "live" as const;
  // Whether the API wants "Bearer <token>" or the raw token. The docs disagree, so we learn it on first use.
  private bearer = true;
  // Diagnostics for the connection test: how many users Smartflo returned and what a user record looks like.
  private usersSeen = 0;
  private sampleKeys = "";

  constructor(
    private creds: SmartfloCredentials,
    private cacheKey: string,
  ) {}

  private async token(force = false): Promise<string> {
    if ("token" in this.creds) return this.creds.token;
    if (!force) {
      let hit = tokenCache.get(this.cacheKey);
      if (!hit || hit.exp <= Date.now() + 60_000) {
        const stored = await loadStoredAuth(this.cacheKey);
        if (stored && stored.exp > Date.now() + 60_000) {
          tokenCache.set(this.cacheKey, stored);
          hit = stored;
        }
      }
      if (hit && hit.exp > Date.now() + 60_000) {
        this.bearer = hit.bearer;
        return hit.token;
      }
    }
    const res = await fetch(`${env.smartfloBase}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: this.creds.email, password: this.creds.password }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Rec;
    if (!res.ok || !body.access_token) {
      throw new SmartfloError(
        `Smartflo login failed (${res.status}): ${String(body.message ?? body.error ?? "check email and password")}`,
        res.status,
      );
    }
    const raw = Number(body.expires_in ?? 3600);
    const seconds = raw > 100_000 ? raw / 1000 : raw;
    await storeAuth(this.cacheKey, {
      token: String(body.access_token),
      exp: Date.now() + Math.min(seconds, 55 * 60) * 1000,
      bearer: this.bearer,
    });
    return String(body.access_token);
  }

  /** Remember which header format worked, so the next instance does not have to guess again. */
  private async rememberBearer() {
    const hit = tokenCache.get(this.cacheKey);
    if (hit && hit.bearer !== this.bearer) await storeAuth(this.cacheKey, { ...hit, bearer: this.bearer });
  }

  private async request<T>(path: string, init: RequestInit & { query?: Rec } = {}): Promise<T> {
    const url = new URL(`${env.smartfloBase}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(`${k}[]`, String(x)));
      else url.searchParams.set(k, String(v));
    }
    const attempt = async (force: boolean) => {
      const token = await this.token(force);
      return fetch(url, {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          authorization: this.bearer ? `Bearer ${token}` : token,
          ...(init.headers as Record<string, string> | undefined),
        },
        cache: "no-store",
      });
    };
    let res = await attempt(false);
    if (res.status === 401) {
      // First try the other header format with the same token (no new login), and only then log in again.
      this.bearer = !this.bearer;
      res = await attempt(false);
      if (res.status === 401) {
        this.bearer = !this.bearer;
        res = await attempt(true);
      }
      if (res.ok) await this.rememberBearer();
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = typeof body === "object" && body ? String((body as Rec).message ?? (body as Rec).error ?? "") : "";
      throw new SmartfloError(`Smartflo ${path} failed (${res.status}) ${msg}`.trim(), res.status);
    }
    return body as T;
  }

  async testConnection() {
    try {
      this.usersSeen = 0;
      this.sampleKeys = "";
      const agents = await this.listAgents();
      const note =
        agents.length === 0
          ? this.usersSeen === 0
            ? "Smartflo returned no users at all. Check that this login or token can read users (API Connect)."
            : `Smartflo returned ${this.usersSeen} users but none has an agent profile. Fields seen on a user: ${this.sampleKeys}.`
          : undefined;
      return { ok: true as const, agents: agents.length, note };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Connection failed" };
    }
  }

  async listAgents(): Promise<SfAgent[]> {
    const out: SfAgent[] = [];
    let last: number | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await this.request<{ data?: Rec[]; has_more?: boolean; last_seen_id?: number }>("/v1/users", {
        query: { limit: 100, last_seen_id: last },
      });
      for (const u of page.data ?? []) {
        this.usersSeen++;
        if (!this.sampleKeys) this.sampleKeys = Object.keys(u).slice(0, 25).join(", ");
        const a = normalizeUserAsAgent(u);
        if (a) out.push(a);
      }
      if (!page.has_more || !page.last_seen_id) break;
      last = page.last_seen_id;
    }
    return out;
  }

  async listCalls({ from, to }: { from: Date; to: Date }): Promise<SfCall[]> {
    const out: SfCall[] = [];
    const limit = 100;
    for (let page = 1; page <= 200; page++) {
      const res = await this.request<{ results?: Rec[] }>("/v1/call/records", {
        query: { from_date: istStamp(from), to_date: istStamp(to), page, limit },
      });
      const rows = res.results ?? [];
      for (const r of rows) {
        const c = normalizeCdr(r);
        if (c) out.push(c);
      }
      if (rows.length < limit) break;
    }
    return out;
  }

  async liveCalls(): Promise<SfLiveCall[]> {
    const res = await this.request<Rec[] | { data?: Rec[] }>("/v1/live_calls");
    const rows = Array.isArray(res) ? res : (res.data ?? []);
    return rows.map(normalizeLive).filter((x): x is SfLiveCall => !!x);
  }

  async clickToCall(input: ClickToCallInput): Promise<{ refId: string }> {
    const res = await this.request<Rec>("/v1/click_to_call_support", {
      method: "POST",
      body: JSON.stringify({
        customer_number: input.customerNumber.replace(/^\+/, ""),
        api_key: input.apiKey,
        async: 1,
        ...(input.callerId ? { caller_id: input.callerId } : {}),
        ...(input.customIdentifier ? { custom_identifier: input.customIdentifier } : {}),
      }),
    });
    if (res.success === false) throw new SmartfloError(String(res.message ?? "Click-to-call was rejected"));
    return { refId: String(res.ref_id ?? "") };
  }

  /**
   * Smartflo "Initiate Click to Call". The agent's phone rings first, then the member.
   * UNVERIFIED against a real account: the field names below follow Tata's reference
   * (docs.smartflo.tatatelebusiness.com, "Initiate Click to Call"); confirm them with one real call.
   */
  async clickToCallAgent(input: AgentCallInput): Promise<{ refId: string; message?: string }> {
    const digits = (n: string) => n.replace(/[^\d]/g, "");
    const res = await this.request<Rec>("/v1/click_to_call", {
      method: "POST",
      body: JSON.stringify({
        agent_number: digits(input.agentNumber),
        destination_number: digits(input.destinationNumber),
        async: 1,
        ...(input.callerId ? { caller_id: digits(input.callerId) } : {}),
        ...(input.customIdentifier ? { custom_identifier: JSON.stringify(input.customIdentifier) } : {}),
      }),
    });
    if (res.success === false) throw new SmartfloError(String(res.message ?? "Click-to-call was rejected"));
    return { refId: String(res.ref_id ?? res.call_id ?? res.uuid ?? ""), message: res.message ? String(res.message) : undefined };
  }
}
