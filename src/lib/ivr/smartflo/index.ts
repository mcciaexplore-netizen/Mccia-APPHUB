import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { integrations } from "@/db/ivr-schema";
import { decryptJson } from "@/lib/ivr/crypto";
import { env } from "@/lib/ivr/env";
import { LiveSmartflo, type SmartfloCredentials } from "./live";
import { MockSmartflo } from "./mock";
import { SmartfloError, type SmartfloProvider } from "./types";

export * from "./types";

export async function getOrgIntegration() {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.provider, "smartflo_org"), isNull(integrations.userId)))
    .limit(1);
  return row ?? null;
}

/** The provider for the organisation-wide Smartflo connection. */
export async function getSmartflo(): Promise<SmartfloProvider> {
  if (env.smartfloMode === "mock") return new MockSmartflo();
  const row = await getOrgIntegration();
  if (!row?.encryptedSecret) throw new SmartfloError("Smartflo is not connected yet. The Support Admin can connect it in IVR-CRM Admin → Integrations.");
  return new LiveSmartflo(decryptJson<SmartfloCredentials>(row.encryptedSecret), row.id);
}

export function providerFromCredentials(creds: SmartfloCredentials, cacheKey = "test"): SmartfloProvider {
  return env.smartfloMode === "mock" ? new MockSmartflo() : new LiveSmartflo(creds, cacheKey);
}
