import { redirect } from "next/navigation";

/** Bulk add lives under Users now; old links land there. */
export default function Page() {
  redirect("/administrator/users/import");
}
