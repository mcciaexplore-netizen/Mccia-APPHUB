import { notFound } from "next/navigation";
import { HubShell } from "@/components/HubShell";
import { EditorLoader } from "@/components/eru/editor/EditorLoader";
import { requireMember } from "@/lib/eru/dal";
import { unreadNotices } from "@/lib/eru/host-adapter";
import { documentForEditor } from "@/lib/eru/queries";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = await documentForEditor((await params).id);
  return { title: d ? `${d.doc.title} · ERU · MCCIA App Hub` : "ERU · MCCIA App Hub" };
}

/** The document editor, the full width of the page (no sidebar). `?converted=1`: just imported from a PDF or a .pptx (the page warns about formatting). */
export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ converted?: string }> }) {
  const u = await requireMember();
  const { id } = await params;
  const converted = (await searchParams).converted === "1";
  const [d, unread] = await Promise.all([documentForEditor(id), unreadNotices(u.id)]);
  if (!d) notFound();
  return (
    <HubShell user={{ name: u.name, role: u.hubRole }} unread={unread}>
      <EditorLoader doc={d.doc} project={d.project} comments={d.comments} me={{ id: u.id, name: u.name, admin: u.admin }} converted={converted} />
    </HubShell>
  );
}
