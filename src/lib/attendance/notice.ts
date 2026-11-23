import "server-only";
import { notify as bell, siteOrigin } from "./host-adapter";
import { pushTo, vapidPublicKey } from "./push";

/** The contact the push services are given: ATT_VAPID_SUBJECT, else the site's address; null when neither can be had. */
function pushSubject(): string | null {
  const s = process.env.ATT_VAPID_SUBJECT?.trim();
  if (s) return s;
  try {
    return siteOrigin();
  } catch {
    return null;
  }
}

/**
 * Tells people something: the hub bell (always), and a phone notification on every browser they turned notifications on in (push.ts). The
 * phone shows the newest notice, fetched by the service worker. Never throws: a notice must not undo what caused it.
 */
export async function notify(notices: { userId: string; title: string; body?: string; link?: string; key: string }[]): Promise<void> {
  if (!notices.length) return;
  await bell(notices);
  try {
    const subject = vapidPublicKey() ? pushSubject() : null;
    if (subject) await pushTo(notices.map((n) => n.userId), subject);
  } catch {
    // the bell has it
  }
}
