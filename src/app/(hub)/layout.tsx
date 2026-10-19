import { requireUser } from "@/lib/permissions";
import { HubShell } from "@/components/HubShell";
import { noticeUnread } from "@/lib/notice-feed";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unread = await noticeUnread(user.id);
  return <HubShell user={{ name: user.name, role: user.role }} unread={unread}>{children}</HubShell>;
}
