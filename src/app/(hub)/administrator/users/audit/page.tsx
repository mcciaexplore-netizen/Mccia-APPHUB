import { redirect } from "next/navigation";

/** The audit log is the Admin changes tab of the Activity Log now; old links and bookmarks land there, with their filters. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams({ tab: "changes" });
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string" && k !== "tab") q.set(k, v);
  redirect(`/administrator/activity?${q}`);
}
