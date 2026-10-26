import { MailTest } from "@/components/MailTest";
import { NotificationList } from "@/components/NotificationList";
import { noticeFeed } from "@/lib/notice-feed";
import { requireAdministrator } from "@/lib/permissions";
import { isSuper } from "@/lib/rbac";

export const metadata = { title: "Notifications · MCCIA App Hub" };

/** What the email settings are, shown without the password (the address and server only). */
const mailStatus = () => ({
  configured: !!(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim()),
  host: process.env.SMTP_HOST?.trim() ?? "", port: process.env.SMTP_PORT?.trim() || "587",
  from: process.env.SMTP_FROM?.trim() ?? "", user: process.env.SMTP_USER?.trim() ?? "",
});

/**
 * The administrator's own notifications: requests waiting for them, access and role changes, and decisions on their requests. The Support
 * Admin also sees whether email (Zoho) is set up, with a test button.
 */
export default async function Page() {
  const me = await requireAdministrator();
  return (
    <>
      <h2 className="mb-5 text-xl">Notification Panel</h2>
      {isSuper(me) && <MailTest status={mailStatus()} />}
      <NotificationList items={await noticeFeed(me.id)} />
    </>
  );
}
