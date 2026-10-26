import Link from "next/link";
import { Network, Upload } from "lucide-react";
import { PeopleDirectory } from "@/components/people/PeopleDirectory";
import { loadDirectory } from "@/lib/people-page";
import { requireArea } from "@/lib/permissions";
import { hasArea } from "@/lib/rbac";

export const metadata = { title: "Users · MCCIA App Hub" };
// A change that touches hundreds of people, or a batch of sign-in emails, is given room to finish.
export const maxDuration = 60;

/** Users: everyone who can sign in, searchable and filterable, with adding, editing, deactivating and deleting, and their applications. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireArea("people");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl">Users</h2>
        <div className="flex flex-wrap gap-2">
          {hasArea(me, "import") && <Link href="/administrator/users/import" className="btn btn-ghost btn-sm"><Upload size={14} /> Bulk add</Link>}
          {hasArea(me, "org") && <Link href="/administrator/users/org" className="btn btn-ghost btn-sm"><Network size={14} /> Branches &amp; teams</Link>}
        </div>
      </div>
      <PeopleDirectory {...await loadDirectory(me, await searchParams, "/administrator/users")} />
    </div>
  );
}
