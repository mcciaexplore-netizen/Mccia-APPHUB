import { redirect } from "next/navigation";

/** There is one expense form for every amount now; the old ₹10,000+ address opens it, with anything carried in the address kept. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
  redirect(`/approvals/expenses/new${q.size ? `?${q}` : ""}`);
}
