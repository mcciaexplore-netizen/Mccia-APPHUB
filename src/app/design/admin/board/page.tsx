import { Board } from "@/components/design/board/Board";
import { BOARD_FILTERS, type BoardFilter } from "@/lib/design/board-filters";
import { PageHeader } from "@/components/design/ui";
import { listTypes } from "@/lib/design/config";
import { requireTeam } from "@/lib/design/dal";
import { listViews } from "@/lib/design/detail";
import { listAssignable } from "@/lib/design/host-adapter";
import { listTickets, teamFilter } from "@/lib/design/tickets";

/**
 * The board: for a lead every accepted ticket, for a designer the ones assigned to them; by stage or by person. ?filter=active|overdue|
 * in_review|delivered opens it on that quick filter (the dashboard's number cards link here).
 */
export default async function AdminBoardPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const u = await requireTeam();
  const { filter } = await searchParams;
  const initialFilter: BoardFilter = filter && filter in BOARD_FILTERS ? (filter as BoardFilter) : "all";
  const [tickets, people, views, types] = await Promise.all([
    listTickets(teamFilter(u, { excludeStatuses: ["pending_review", "declined", "superseded"] })),
    listAssignable(),
    listViews(u),
    listTypes(true),
  ]);
  return (
    <div>
      <PageHeader
        title={u.lead ? "Team board" : "My board"}
        subtitle={u.lead ? "Every accepted ticket. Drag cards between columns; tick several to move or assign them together." : "The tickets assigned to you. Drag cards between columns as the work moves on."}
      />
      <Board tickets={tickets} scope="all" lead={u.lead} people={people.map((p) => ({ id: p.id, name: p.name }))} views={views} types={types.map((t) => ({ key: t.key, name: t.name }))} initialFilter={initialFilter} key={initialFilter} />
    </div>
  );
}
