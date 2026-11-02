import { Board } from "@/components/design/board/Board";
import { PageHeader } from "@/components/design/ui";
import { requireTeam } from "@/lib/design/dal";
import { listTypes } from "@/lib/design/config";
import { listViews } from "@/lib/design/detail";
import { listTickets } from "@/lib/design/tickets";

export const metadata = { title: "Board · Design Team" };

/** The designer's own tickets as a kanban board (the full team board is in Design Team Admin). */
export default async function TeamBoard() {
  const u = await requireTeam();
  const [tickets, views, types] = await Promise.all([
    listTickets({ assigneeId: u.id, excludeStatuses: ["pending_review", "declined", "superseded"] }),
    listViews(u),
    listTypes(true),
  ]);
  return (
    <div>
      <PageHeader title="Board" subtitle="Your tickets by stage. Drag a card to move it." />
      <Board tickets={tickets} scope="mine" lead={u.lead} people={[]} views={views} types={types.map((t) => ({ key: t.key, name: t.name }))} />
    </div>
  );
}
