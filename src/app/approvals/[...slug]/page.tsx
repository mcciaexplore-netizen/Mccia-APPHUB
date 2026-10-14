import { notFound } from "next/navigation";
import { ListScreenView } from "@/components/approvals/ListScreenView";
import { Placeholder } from "@/components/approvals/Placeholder";
import { allNavItems, canSee } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";
import { parseListParams } from "@/lib/approvals/list-params";
import { screenFor } from "@/lib/approvals/screens";

/**
 * The list screens (Approved HR requests, Pending Expenditure Requests, the DG's inbox, ...) all live here: each is the same table with
 * a different starting filter (see screens.ts). A path that is not in the menu, or that this person's roles do not allow, is a plain
 * 404. A real page placed at the same path takes over from this one.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const path = `/approvals/${slug.join("/")}`;
  const item = allNavItems().find((i) => i.href === path);
  const screen = screenFor(slug);
  if (!item && !screen) notFound();
  const user = await requirePage();
  if (item && !canSee(item, user.roles)) notFound();
  if (screen) return <ListScreenView slug={slug.join("/")} screen={screen} params={parseListParams(await searchParams)} user={user} />;
  return <Placeholder title={item!.label} />;
}
