import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestView } from "@/components/aistudio/admin/RequestView";
import { requireTeam } from "@/lib/aistudio/dal";
import { adminDetail } from "@/lib/aistudio/queries";
import { getRequest } from "@/lib/aistudio/requests";

export const metadata = { title: "Request · AI Studio Admin" };

/** One request, for the AI Studio team. */
export default async function AdminRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireTeam();
  const { id } = await params;
  if (!(await getRequest(id))) notFound();
  const d = await adminDetail(u, id);
  return (
    <div className="flex flex-col gap-3">
      <Link href="/aistudio/admin/requests" className="text-sm font-semibold text-[var(--ai-navy)] hover:underline">
        ← All requests
      </Link>
      <RequestView d={d} viewer={{ lead: u.lead }} />
    </div>
  );
}
