import { notFound } from "next/navigation";
import { Placeholder } from "@/components/approvals/Placeholder";
import { allNavItems, canSee } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";

/**
 * Every sidebar link that has no screen of its own yet lands here. A path that is not in the manifest, or that this person's roles
 * do not allow, is a plain 404. A real page placed at the same path takes over automatically.
 */
export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const item = allNavItems().find((i) => i.href === `/approvals/${slug.join("/")}`);
  if (!item) notFound();
  const user = await requirePage();
  if (!canSee(item, user.roles)) notFound();
  return <Placeholder title={item.label} phase={item.phase} />;
}
