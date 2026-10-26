import { redirect } from "next/navigation";

/** A person in User Administration is a person in Users now; old links land there. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/administrator/users/${(await params).id}`);
}
