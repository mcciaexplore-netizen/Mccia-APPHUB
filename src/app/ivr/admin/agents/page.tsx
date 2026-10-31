import { asc } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { smartfloAgents } from "@/db/ivr-schema";
import { AgentsManager, type AgentOpt, type AgentRowDTO } from "@/components/ivr/admin/agents-manager";
import { PageHeader } from "@/components/ivr/ui";
import { getAgentWorkload } from "@/lib/ivr/assign";
import { requireAdmin } from "@/lib/ivr/dal";
import { listIvrAgents, namesOf } from "@/lib/ivr/host-adapter";

export const metadata = { title: "Agents" };

/** The Membership team as IVR-CRM sees it: everyone given IVR-CRM in the hub, and how each is reached through Smartflo. */
export default async function AgentsPage() {
  await requireAdmin();
  const [agents, sf, workload] = await Promise.all([
    listIvrAgents(),
    db.select().from(smartfloAgents).orderBy(asc(smartfloAgents.name)),
    getAgentWorkload(),
  ]);
  const takenNames = await namesOf([...new Set(sf.map((a) => a.mappedUserId).filter((x): x is string => !!x))]);
  const dto: AgentRowDTO[] = agents.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    softphoneExtension: u.softphoneExtension,
    agentId: sf.find((a) => a.mappedUserId === u.id)?.id ?? null,
    open: workload.find((w) => w.id === u.id)?.open ?? 0,
  }));
  const opts: AgentOpt[] = sf.map((a) => ({
    id: a.id,
    label: `${a.name}${a.number ? ` · ${a.number}` : ""}`,
    takenBy: a.mappedUserId ? (takenNames.get(a.mappedUserId) ?? "someone else") : null,
  }));
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Agents"
        subtitle="Everyone given the IVR-CRM application in the hub. Link each to their Smartflo agent so their calls are theirs. To add or remove an agent, give or take away IVR-CRM in Administrator → Applications."
      />
      <AgentsManager agents={dto} smartflo={opts} />
    </div>
  );
}
