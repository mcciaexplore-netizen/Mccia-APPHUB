import { NotificationList } from "@/components/NotificationList";
import { noticeFeed } from "@/lib/notice-feed";
import { requireAdministrator } from "@/lib/permissions";

export const metadata = { title: "Notifications · MCCIA App Hub" };

/** The administrator's own notifications: requests waiting for them, access and role changes, and decisions on their requests. */
export default async function Page() {
  const me = await requireAdministrator();
  return <NotificationList items={await noticeFeed(me.id)} />;
}
