import { requireAdministrator } from "@/lib/permissions";
import { peopleTabsFor } from "@/lib/admin-tabs";
import { PeopleNav } from "./PeopleNav";

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdministrator();
  return (
    <>
      <PeopleNav show={peopleTabsFor(me).map((t) => t.label as "People")} />
      {children}
    </>
  );
}
