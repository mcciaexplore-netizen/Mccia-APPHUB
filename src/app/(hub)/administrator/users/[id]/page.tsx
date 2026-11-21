import { notFound } from "next/navigation";
import { ProfileView } from "@/components/people/ProfileView";
import { loadProfile } from "@/lib/people-page";
import { requireArea } from "@/lib/permissions";
import { WatchingRules } from "@/components/approvals/WatchingRules";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { listRulesOf, watchableCategories } from "@/lib/approvals/watchers";
import { isSuper } from "@/lib/rbac";

export const metadata = { title: "Person · MCCIA App Hub" };
export const maxDuration = 60;

/**
 * One person: their overview (editable as far as the actor may), their application access, and their activity and sign-ins. For the
 * Support Admin, also what they watch in the Approval System (approval types and expense categories they may view without approving).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireArea("people");
  const { id } = await params;
  const profile = await loadProfile(me, id, "/administrator/users");
  if (!profile) notFound();
  const watching = approvalsEnabled() && isSuper(me)
    ? await Promise.all([listRulesOf(id), watchableCategories()]).then(([rules, categories]) => (
      <WatchingRules userId={id} personName={profile.person.name} rules={rules} categories={categories} />
    ))
    : null;
  return <ProfileView {...profile} watching={watching} />;
}
