import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { integrations } from "@/db/ivr-schema";
import { decryptJson, encryptJson, safeEqual } from "./crypto";
import { env } from "./env";

export const ZOHO_SCOPES = "ZohoMail.messages.CREATE,ZohoMail.accounts.READ";

type Stored = {
  refreshToken: string;
  accessToken: string;
  expiresAt: number; // epoch ms
  accountId: string;
  fromAddress: string;
};

export class ZohoError extends Error {}

const accountsUrl = (path: string) => `https://accounts.${env.zoho.domain}${path}`;
const mailUrl = (path: string) => `https://mail.${env.zoho.domain}${path}`;
const redirectUri = () => `${env.appUrl}/api/ivr/zoho/callback`;

export const zohoConfigured = () => !!env.zoho.clientId && !!env.zoho.clientSecret;

// ---- CSRF state: userId.nonce.expiry.signature -------------------------------------------------

function sign(data: string): string {
  return createHmac("sha256", `ivr-crm:zoho-state:${env.appSecret}`).update(data).digest("base64url");
}

export function createState(userId: string): string {
  const data = `${userId}.${randomBytes(8).toString("hex")}.${Date.now() + 10 * 60_000}`;
  return `${data}.${sign(data)}`;
}

/** Returns true only when the state was issued by us, for this user, and has not expired. */
export function verifyState(state: string | null, userId: string): boolean {
  if (!state) return false;
  const i = state.lastIndexOf(".");
  if (i < 0) return false;
  const data = state.slice(0, i);
  if (!safeEqual(state.slice(i + 1), sign(data))) return false;
  const [uid, , exp] = data.split(".");
  return uid === userId && Number(exp) > Date.now();
}

export function buildConsentUrl(userId: string): string {
  const u = new URL(accountsUrl("/oauth/v2/auth"));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.zoho.clientId);
  u.searchParams.set("scope", ZOHO_SCOPES);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", createState(userId));
  return u.toString();
}

// ---- Zoho HTTP ---------------------------------------------------------------------------------

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(accountsUrl("/oauth/v2/token"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.zoho.clientId,
      client_secret: env.zoho.clientSecret,
      redirect_uri: redirectUri(),
      ...params,
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error || !body.access_token) {
    throw new ZohoError(friendlyTokenError(body.error));
  }
  return body;
}

function friendlyTokenError(code?: string): string {
  switch (code) {
    case "invalid_code":
      return "Zoho rejected the sign-in code. It may have expired. Try connecting again.";
    case "invalid_client":
    case "invalid_client_secret":
      return "Zoho does not recognise the app credentials. Check ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_DOMAIN.";
    case "invalid_redirect_uri":
      return `The redirect URI ${redirectUri()} is not registered in the Zoho API Console.`;
    case "access_denied":
      return "Zoho Mail access was not granted.";
    default:
      return `Zoho sign-in failed${code ? ` (${code})` : ""}. Try connecting again.`;
  }
}

type ZohoEnvelope<T> = { status?: { code?: number; description?: string }; data?: T };

async function zohoJson<T>(
  url: string,
  accessToken: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ZohoEnvelope<T>> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Zoho-oauthtoken ${accessToken}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as ZohoEnvelope<T> & { data?: { errorCode?: string; moreInfo?: string } };
  const code = body.status?.code ?? res.status;
  if (!res.ok || code >= 400) {
    const detail =
      (body.data as { moreInfo?: string } | undefined)?.moreInfo ?? body.status?.description ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new ZohoError("Zoho no longer accepts this connection. Reconnect Zoho Mail from Connections.");
    if (res.status === 403) throw new ZohoError(`Zoho refused the request: ${detail}`);
    throw new ZohoError(`Zoho Mail error: ${detail}`);
  }
  return body;
}

type ZohoAccount = {
  accountId?: string;
  primaryEmailAddress?: string;
  emailAddress?: { mailId?: string; isPrimary?: boolean }[];
};

async function loadAccount(accessToken: string): Promise<{ accountId: string; fromAddress: string }> {
  const res = await zohoJson<ZohoAccount[]>(mailUrl("/api/accounts"), accessToken);
  const acc = res.data?.[0];
  if (!acc?.accountId) throw new ZohoError("This Zoho login has no Mail account.");
  const from =
    acc.primaryEmailAddress ??
    acc.emailAddress?.find((e) => e.isPrimary)?.mailId ??
    acc.emailAddress?.[0]?.mailId;
  if (!from) throw new ZohoError("Could not read the sender address from the Zoho account.");
  return { accountId: String(acc.accountId), fromAddress: from };
}

// ---- Storage -----------------------------------------------------------------------------------

async function findRow(userId: string) {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, "zoho")))
    .limit(1);
  return row ?? null;
}

async function save(userId: string, data: Stored) {
  const row = await findRow(userId);
  const values = {
    encryptedSecret: encryptJson(data),
    meta: { fromAddress: data.fromAddress },
    status: "connected",
    lastError: null,
    updatedAt: new Date(),
  };
  if (row) await db.update(integrations).set(values).where(eq(integrations.id, row.id));
  else await db.insert(integrations).values({ userId, provider: "zoho", ...values });
}

/** Called from the OAuth callback. Throws ZohoError with a readable message. */
export async function completeConnection(userId: string, code: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code });
  const existing = await findRow(userId);
  // Zoho only returns a refresh token on first consent; fall back to a stored one on re-consent.
  let refreshToken = t.refresh_token;
  if (!refreshToken && existing?.encryptedSecret) refreshToken = decryptJson<Stored>(existing.encryptedSecret).refreshToken;
  if (!refreshToken) throw new ZohoError("Zoho did not return a refresh token. Remove the app in Zoho and connect again.");
  const account = await loadAccount(t.access_token!);
  await save(userId, {
    refreshToken,
    accessToken: t.access_token!,
    expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
    ...account,
  });
  return account.fromAddress;
}

export async function getZohoConnection(userId: string): Promise<{ connected: boolean; fromAddress: string | null }> {
  const row = await findRow(userId);
  if (!row?.encryptedSecret || row.status !== "connected") return { connected: false, fromAddress: null };
  const from = (row.meta as { fromAddress?: string } | null)?.fromAddress ?? null;
  return { connected: true, fromAddress: from };
}

export async function disconnectZoho(userId: string) {
  await db.delete(integrations).where(and(eq(integrations.userId, userId), eq(integrations.provider, "zoho")));
}

async function accessTokenFor(userId: string): Promise<Stored> {
  const row = await findRow(userId);
  if (!row?.encryptedSecret) throw new ZohoError("Zoho Mail is not connected. Connect it from Connections.");
  const s = decryptJson<Stored>(row.encryptedSecret);
  if (s.expiresAt > Date.now() + 60_000) return s;
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refreshToken });
    const next = { ...s, accessToken: t.access_token!, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
    await save(userId, next);
    return next;
  } catch (e) {
    await db
      .update(integrations)
      .set({ status: "error", lastError: e instanceof Error ? e.message : "refresh failed", updatedAt: new Date() })
      .where(eq(integrations.id, row.id));
    throw new ZohoError("Zoho Mail needs to be reconnected. Open Connections and connect it again.");
  }
}

// ---- Sending -----------------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Plain text from the compose box to safe HTML: escape, then keep line breaks. */
export function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>");
}

export async function sendMail(input: {
  userId: string;
  to: string;
  subject: string;
  html: string;
}): Promise<{ messageId: string | null; fromAddress: string }> {
  const s = await accessTokenFor(input.userId);
  const res = await zohoJson<{ messageId?: string | number }>(
    mailUrl(`/api/accounts/${encodeURIComponent(s.accountId)}/messages`),
    s.accessToken,
    {
      method: "POST",
      body: {
        fromAddress: s.fromAddress,
        toAddress: input.to,
        subject: input.subject,
        content: input.html,
        mailFormat: "html",
      },
    },
  );
  const id = res.data?.messageId;
  return { messageId: id === undefined ? null : String(id), fromAddress: s.fromAddress };
}
