import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TicketView } from "@/components/design/ticket/ticket-view";
import { DesignError, requireTeam } from "@/lib/design/dal";
import { ticketDetail, type TicketDetail } from "@/lib/design/detail";

export const metadata = { title: "Ticket · Design Team" };

/** One ticket, for a lead (any ticket) or the designer it is assigned to; anyone else gets "not found". */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireTeam();
  const { id } = await params;
  let d: TicketDetail;
  try {
    d = await ticketDetail(u, id);
  } catch (e) {
    if (e instanceof DesignError) notFound();
    throw e;
  }
  return (
    <Suspense>
      <TicketView d={d} viewer={{ id: u.id, lead: u.lead }} />
    </Suspense>
  );
}
