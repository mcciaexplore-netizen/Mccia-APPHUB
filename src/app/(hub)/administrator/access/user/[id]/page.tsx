import { redirect } from "next/navigation";

// A person's access now lives on their profile, together with everything else about them. Old links and bookmarks land there.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/administrator/users/${encodeURIComponent(id)}`);
}
