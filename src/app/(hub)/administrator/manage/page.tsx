import { redirect } from "next/navigation";

/** User Administration is part of Users now; old links land there. */
export default function Page() {
  redirect("/administrator/users");
}
