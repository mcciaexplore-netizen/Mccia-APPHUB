import { notFound } from "next/navigation";
import { ProfileView } from "@/components/people/ProfileView";
import { loadProfile } from "@/lib/people-page";
import { requireArea } from "@/lib/permissions";
import { WatchingRules } from "@/components/approvals/WatchingRules";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { listRulesOf, watchableCategories } from "@/lib/approvals/watchers";
import { listUsers } from "@/lib/approvals/host-adapter";
import { isSuper } from "@/lib/rbac";

export const metadata = { title: "Person · MCCIA App Hub" };
export const maxDuration = 60;

/**
 * One person: their overview (editable as far as the actor may), their application access, and their activity and sign-ins. For the
 * Support Admin, also what they watch in the Approval System (approval types and expense categories, and people whose every request they
 * may view without approving).
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireArea("people");
  const { id } = await params;
  const profile = await loadProfile(me, id, "/administrator/users");
  if (!profile) notFound();
  const watching = approvalsEnabled() && isSuper(me)
    ? await Promise.all([listRulesOf(id), watchableCategories(), listUsers()]).then(([rules, categories, people]) => (
      <WatchingRules
        userId={id}
        personName={profile.person.name}
        rules={rules}
        categories={categories}
        people={people.filter((p) => p.id !== id).map((p) => ({ id: p.id, name: p.name, email: p.email }))}
      />
    ))
    : null;
  return <ProfileView {...profile} watching={watching} />;
}
