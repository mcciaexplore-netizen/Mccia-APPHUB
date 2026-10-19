import { notFound } from "next/navigation";
import { ProfileView } from "@/components/people/ProfileView";
import { loadProfile } from "@/lib/people-page";
import { requireArea } from "@/lib/permissions";

export const metadata = { title: "Person · MCCIA App Hub" };
export const maxDuration = 60;

/** One person in User Administration: everything about them can be changed here, as far as the actor may. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireArea("people");
  const { id } = await params;
  const profile = await loadProfile(me, id, "/administrator/manage");
  if (!profile) notFound();
  return <ProfileView {...profile} />;
}
