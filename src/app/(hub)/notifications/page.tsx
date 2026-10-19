import { BackLink } from "@/components/BackLink";
import { NotificationList } from "@/components/NotificationList";
import { noticeFeed } from "@/lib/notice-feed";
import { requireUser } from "@/lib/permissions";

export const metadata = { title: "Notifications · MCCIA App Hub" };

/** Everything addressed to the signed-in person, and nothing else. */
export default async function Page() {
  const me = await requireUser();
  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/" label="Home" />
        <h1 className="mt-1 text-3xl sm:text-4xl">Notifications</h1>
      </div>
      <NotificationList items={await noticeFeed(me.id)} />
    </div>
  );
}
