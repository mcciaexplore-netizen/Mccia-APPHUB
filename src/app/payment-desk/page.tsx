import { HubShell } from "@/components/HubShell";
import { PaymentDeskFrame } from "@/components/paymentdesk/PaymentDeskFrame";
import { noticeUnread } from "@/lib/notice-feed";
import { paymentDeskEmbedUrl } from "@/lib/paymentdesk/paymentdesk.manifest";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment Desk · MCCIA App Hub" };

/**
 * Payment Desk inside the hub (see src/lib/paymentdesk/paymentdesk.manifest.ts). Anyone signed in to the hub may open it: the proxy sends
 * everyone else to /login, and requireUser checks again here (and sends someone on a temporary password to choose their own first).
 * Payment Desk has its own sign-in; the hub only passes the person's email so they need not type it.
 */
export default async function PaymentDeskPage() {
  const user = await requireUser();
  const unread = await noticeUnread(user.id);
  return (
    <HubShell user={{ name: user.name, role: user.role }} unread={unread} bleed>
      <PaymentDeskFrame src={paymentDeskEmbedUrl(user.email)} />
    </HubShell>
  );
}
