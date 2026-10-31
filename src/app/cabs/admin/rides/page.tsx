import { redirect } from "next/navigation";

/** All Rides is now All Trips (/cabs/admin/trips). Old links, bell notices among them, go there with their filters. */
export default async function OldAllRides({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const one of [v ?? []].flat()) q.append(k, one);
  const s = q.toString();
  redirect(`/cabs/admin/trips${s ? `?${s}` : ""}`);
}
