import { PeopleNav } from "./PeopleNav";

export default function UsersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PeopleNav />
      {children}
    </>
  );
}
