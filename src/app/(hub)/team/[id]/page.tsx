import { notFound } from "next/navigation";
import { ProfileView } from "@/components/people/ProfileView";
import { loadProfile } from "@/lib/people-page";
import { requireTeamManager } from "@/lib/permissions";

export const metadata = { title: "Team member · MCCIA App Hub" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTeamManager();
  const { id } = await params;
  const profile = await loadProfile(me, id, "/team");
  if (!profile) notFound();
  return <ProfileView {...profile} />;
}
