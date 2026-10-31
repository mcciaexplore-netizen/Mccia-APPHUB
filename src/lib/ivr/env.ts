import "server-only";

const isProd = process.env.NODE_ENV === "production";

function secret(): string {
  const v = process.env.IVR_ENCRYPTION_KEY;
  if (v && v.length >= 32) return v;
  if (isProd) throw new Error("IVR_ENCRYPTION_KEY must be set (at least 32 characters) for IVR-CRM.");
  return "dev-only-ivr-key-change-me-0123456789abcdef";
}

/** IVR-CRM's settings, all from the environment (see .env.example). */
export const env = {
  isProd,
  /** Encrypts the stored Smartflo and Zoho credentials and signs the Zoho OAuth state. */
  get appSecret() {
    return secret();
  },
  /** "live" talks to Tata Smartflo. "mock" uses built-in sample data so the module runs without credentials. */
  get smartfloMode(): "live" | "mock" {
    return (process.env.SMARTFLO_MODE ?? (isProd ? "live" : "mock")) === "live" ? "live" : "mock";
  },
  get smartfloBase() {
    return process.env.SMARTFLO_API_BASE ?? "https://api-smartflo.tatateleservices.com";
  },
  /** Caller ID (your Smartflo DID) shown to members on calls placed from the Call button. Optional. */
  get callerId() {
    return process.env.SMARTFLO_CALLER_ID ?? "";
  },
  /** Path secret appended to the webhook URL, since Smartflo does not sign webhooks. */
  get webhookSecret() {
    return process.env.SMARTFLO_WEBHOOK_SECRET ?? (isProd ? "" : "dev-webhook-secret");
  },
  get cronSecret() {
    return process.env.CRON_SECRET?.trim() ?? "";
  },
  /** Where the hub lives, for the Zoho redirect and the webhook URL shown under Integrations. */
  get appUrl() {
    if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    return "http://localhost:3000";
  },
  zoho: {
    get clientId() {
      return process.env.ZOHO_CLIENT_ID ?? "";
    },
    get clientSecret() {
      return process.env.ZOHO_CLIENT_SECRET ?? "";
    },
    /** zoho.in for India data centre, zoho.com for US, etc. */
    get domain() {
      return process.env.ZOHO_DOMAIN ?? "zoho.in";
    },
  },
};
