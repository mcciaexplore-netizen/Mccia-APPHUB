import { PeopleDirectory } from "@/components/people/PeopleDirectory";
import { loadDirectory } from "@/lib/people-page";
import { requireArea } from "@/lib/permissions";

export const metadata = { title: "Users & Access · MCCIA App Hub" };
// A change that touches hundreds of people, or a setup-link batch, is given room to finish.
export const maxDuration = 60;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireArea("people");
  return <PeopleDirectory {...await loadDirectory(me, await searchParams, "/administrator/users")} />;
}
