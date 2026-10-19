import Link from "next/link";
import { PeopleDirectory } from "@/components/people/PeopleDirectory";
import { loadDirectory, VIEW_ONLY } from "@/lib/people-page";
import { requireArea } from "@/lib/permissions";

export const metadata = { title: "Users · MCCIA App Hub" };

/** Users: everyone, searchable and filterable, to look at. Changes are made in User Administration. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireArea("people");
  const props = await loadDirectory(me, await searchParams, "/administrator/users");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Everyone who can sign in. Open a person to see their details and applications.</p>
        <Link href="/administrator/manage" className="btn btn-primary btn-sm">Manage users</Link>
      </div>
      <PeopleDirectory {...props} caps={VIEW_ONLY} />
    </div>
  );
}
