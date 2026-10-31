import { and, eq } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { integrations, smartfloAgents } from "@/db/ivr-schema";
import { personById } from "@/lib/ivr/host-adapter";
import { IvrCard } from "@/components/ivr/settings/ivr-card";
import { ZohoCard } from "@/components/ivr/settings/zoho-card";
import { Alert, PageHeader } from "@/components/ivr/ui";
import { detectedExtensionFor } from "@/lib/ivr/agent-number";
import { requireUser } from "@/lib/ivr/dal";
import { getZohoConnection } from "@/lib/ivr/zoho";
import { env } from "@/lib/ivr/env";

export const metadata = { title: "Connections" };

const FLASH: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Zoho Mail is connected. You can email leads from the lead panel." },
  "not-configured": { ok: false, text: "Zoho Mail is not set up for this workspace yet. Ask the Support Admin to add the Zoho client details." },
  error: { ok: false, text: "Zoho did not complete the connection. Try again." },
};

export default async function SettingsPage({ searchParams }: PageProps<"/ivr/connections">) {
  const user = await requireUser();
  const sp = await searchParams;
  const zohoFlag = Array.isArray(sp.zoho) ? sp.zoho[0] : sp.zoho;

  const [agentRows, c2cRows, me, detectedExt, zoho] = await Promise.all([
    db.select().from(smartfloAgents).where(eq(smartfloAgents.mappedUserId, user.id)).limit(1),
    db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.userId, user.id), eq(integrations.provider, "smartflo_c2c")))
      .limit(1),
    personById(user.id),
    detectedExtensionFor(user.id),
    getZohoConnection(user.id),
  ]);
  const [agent] = agentRows;
  const [c2c] = c2cRows;
  const flash = zohoFlag ? FLASH[zohoFlag] : undefined;

  return (
    <div className="grid max-w-3xl gap-5">
      <PageHeader title="Connections" subtitle="Link your phone line and your mailbox so calls and emails sit next to each lead." />
      {flash && (
        <Alert kind={flash.ok ? "success" : "error"} role="status">
          {flash.text}
        </Alert>
      )}
      <IvrCard
        linkedAgent={agent ? { name: agent.name, number: agent.number, extension: agent.extension } : null}
        hasKey={!!c2c}
        softphoneExtension={me?.softphoneExtension ?? ""}
        detectedExtension={detectedExt}
        mode={env.smartfloMode}
      />
      <ZohoCard connected={zoho.connected} account={zoho.fromAddress} />
    </div>
  );
}
