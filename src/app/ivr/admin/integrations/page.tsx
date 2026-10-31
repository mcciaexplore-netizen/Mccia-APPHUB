import { asc, count, eq } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { integrations, smartfloAgents } from "@/db/ivr-schema";
import { listIvrAgents } from "@/lib/ivr/host-adapter";
import { MembershipScope } from "@/components/ivr/admin/membership-scope";
import { SmartfloPanel } from "@/components/ivr/admin/smartflo-panel";
import { PageHeader } from "@/components/ivr/ui";
import { requireSuperAdmin } from "@/lib/ivr/dal";
import { env } from "@/lib/ivr/env";
import { getAutoSyncConfig, getMembershipLines } from "@/lib/ivr/settings";
import { zohoConfigured } from "@/lib/ivr/zoho";
import { getOrgIntegration } from "@/lib/ivr/smartflo";
import { ensureOrgIntegration } from "@/lib/ivr/smartflo/sync";
import { formatIst } from "@/lib/ivr/time";

export const metadata = { title: "Integrations" };
// The sync buttons are server actions on this page; a 30-day backfill can take longer than the default function limit.
export const maxDuration = 300;

export default async function IntegrationsPage() {
  await requireSuperAdmin();
  const org = (await getOrgIntegration()) ?? (await ensureOrgIntegration());
  const [agents, zohoUsers] = await Promise.all([
    db
      .select({
        id: smartfloAgents.id,
        name: smartfloAgents.name,
        number: smartfloAgents.number,
        extension: smartfloAgents.extension,
        mapped: smartfloAgents.mappedUserId,
      })
      .from(smartfloAgents)
      .orderBy(asc(smartfloAgents.name)),
    db.select({ n: count() }).from(integrations).where(eq(integrations.provider, "zoho")),
  ]);
  const [lines, autoSync] = await Promise.all([getMembershipLines(), getAutoSyncConfig()]);
  const lastTick = (org?.meta?.lastTick ?? null) as { at: string; fetched: number; upserted: number; ms: number } | null;
  const totalUsers = [{ n: (await listIvrAgents()).length }];
  const webhookUrl = `${env.appUrl}/api/ivr/webhooks/smartflo/${env.webhookSecret || "SET-SMARTFLO_WEBHOOK_SECRET"}`;
  const connected = env.smartfloMode === "mock" ? true : !!org?.encryptedSecret;

  return (
    <div className="grid max-w-4xl gap-5">
      <PageHeader title="Integrations" subtitle="Connect Tata Smartflo for calls and recordings, and see who has linked Zoho Mail." />
      <SmartfloPanel
        mode={env.smartfloMode}
        connected={connected}
        status={org?.status ?? "disconnected"}
        lastSync={org?.lastSyncAt ? formatIst(org.lastSyncAt, { year: "numeric" }) : null}
        lastError={org?.lastError ?? null}
        webhookUrl={webhookUrl}
        mapped={agents.filter((a) => a.mapped).length}
        totalAgents={agents.length}
        autoSync={autoSync}
        lastTick={lastTick ? { text: `${formatIst(lastTick.at)}: ${lastTick.fetched} fetched, ${lastTick.upserted} kept, ${(lastTick.ms / 1000).toFixed(1)}s` } : null}
        cronUrl={`${env.appUrl}/api/cron/ivr-sync`}
      />
      <MembershipScope initial={lines} mappedAgents={agents.filter((a) => a.mapped).length} />
      <p className="text-[13px] text-muted">
        Link each Smartflo agent to an IVR-CRM agent under <a className="text-primary underline" href="/ivr/admin/agents">Agents</a>. Agents whose phone number matches a
        user are linked automatically on every sync.
      </p>
      <details className="ivr-card p-5">
        <summary className="cursor-pointer text-lg font-bold">Smartflo agents as Smartflo reports them ({agents.length})</summary>
        <p className="mt-2 text-[13px] text-muted">
          What Smartflo sent for each agent. Use it to find the right softphone extension (digits like 060…) or agent ID to put under Connections.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="ivr-th">Name</th>
                <th className="ivr-th">Agent ID</th>
                <th className="ivr-th">Phone</th>
                <th className="ivr-th">Extension</th>
                <th className="ivr-th">Linked</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td className="ivr-td font-semibold">{a.name}</td>
                  <td className="ivr-td font-mono">{a.id}</td>
                  <td className="ivr-td font-mono">{a.number ?? "–"}</td>
                  <td className="ivr-td font-mono">{a.extension ?? "–"}</td>
                  <td className="ivr-td">{a.mapped ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <section className="ivr-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Zoho Mail</h2>
            <p className="text-[13px] text-muted">Each agent connects their own mailbox from Connections. Nothing to enter here except the server settings.</p>
          </div>
          <span className="text-[13px] font-semibold tabular-nums">
            {zohoUsers[0].n} of {totalUsers[0].n} agents connected
          </span>
        </div>
        <p className="mt-3 text-[13px]">
          {zohoConfigured() ? (
            <span className="text-brand-green-text">Zoho client is configured (data centre {env.zoho.domain}).</span>
          ) : (
            <span className="text-brand-purple">
              Zoho client is not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_DOMAIN. See docs/ivr-zoho-setup.md.
            </span>
          )}
        </p>
      </section>
    </div>
  );
}
