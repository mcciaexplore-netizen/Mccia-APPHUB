import Link from "next/link";
import { notFound } from "next/navigation";
import { ProfileView } from "@/components/people/ProfileView";
import { loadProfile, VIEW_ONLY } from "@/lib/people-page";
import { requireArea } from "@/lib/permissions";

export const metadata = { title: "Person · MCCIA App Hub" };

/**
 * One person in Users: their details to look at, and their application access, which can be given or taken away here at any time (the
 * server checks who may, as everywhere). Their details, role, deactivating and deleting are changed in User Administration (the button).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireArea("people");
  const { id } = await params;
  const profile = await loadProfile(me, id, "/administrator/users");
  if (!profile) notFound();
  const canChange = profile.caps.editPerson || profile.caps.toggleActive || profile.caps.remove;
  return (
    <div className="space-y-4">
      {canChange && <div className="flex justify-end"><Link href={`/administrator/manage/${id}`} className="btn btn-ghost btn-sm">Edit details in User Administration</Link></div>}
      <ProfileView {...profile} caps={{ ...profile.caps, ...VIEW_ONLY, editPerson: false }} accessEditable={profile.accessEditable} />
    </div>
  );
}
