import { Board } from "@/components/design/board/Board";
import { PageHeader } from "@/components/design/ui";
import { listTypes } from "@/lib/design/config";
import { requireLead } from "@/lib/design/dal";
import { listViews } from "@/lib/design/detail";
import { listAssignable } from "@/lib/design/host-adapter";
import { listTickets } from "@/lib/design/tickets";

/** The whole team's board: every accepted ticket, by stage or by person. */
export default async function AdminBoardPage() {
  const u = await requireLead();
  const [tickets, people, views, types] = await Promise.all([
    listTickets({ excludeStatuses: ["pending_review", "declined", "superseded"] }),
    listAssignable(),
    listViews(u),
    listTypes(true),
  ]);
  return (
    <div>
      <PageHeader title="Team board" subtitle="Every accepted ticket. Drag cards between columns; tick several to move or assign them together." />
      <Board tickets={tickets} scope="all" lead people={people.map((p) => ({ id: p.id, name: p.name }))} views={views} types={types.map((t) => ({ key: t.key, name: t.name }))} />
    </div>
  );
}
