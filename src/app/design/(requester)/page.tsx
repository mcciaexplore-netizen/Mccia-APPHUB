import { redirect } from "next/navigation";
import { requireRequester } from "@/lib/design/dal";

/** The Design Team tile opens here: the request form is the requester's home. */
export default async function DesignHome() {
  await requireRequester();
  redirect("/design/request");
}
