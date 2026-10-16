import { notFound } from "next/navigation";
import { ProfileView } from "@/components/people/ProfileView";
import { loadProfile } from "@/lib/people-page";
import { requireArea } from "@/lib/permissions";

export const metadata = { title: "Person · MCCIA App Hub" };
export const maxDuration = 60;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireArea("people");
  const { id } = await params;
  const profile = await loadProfile(me, id, "/administrator/users");
  if (!profile) notFound();
  return <ProfileView {...profile} />;
}
