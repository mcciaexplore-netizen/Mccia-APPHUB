import { PeopleDirectory } from "@/components/people/PeopleDirectory";
import { loadDirectory } from "@/lib/people-page";
import { requireTeamManager } from "@/lib/permissions";

export const metadata = { title: "My team · MCCIA App Hub" };
export const maxDuration = 60;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireTeamManager();
  const props = await loadDirectory(me, await searchParams, "/team");
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">The people in your team and the people who report to you. You can give or take away the applications that you can open yourself. Anything else is managed by an administrator.</p>
      <PeopleDirectory {...props} />
    </div>
  );
}
