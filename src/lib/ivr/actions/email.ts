"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/ivr/db";
import { emails, leads } from "@/db/ivr-schema";
import { audit } from "@/lib/ivr/audit";
import { HttpError, assertUser, isAdminRole } from "@/lib/ivr/dal";
import { ZohoError, disconnectZoho, sendMail, textToHtml } from "@/lib/ivr/zoho";

export type EmailResult = { ok: true } | { ok: false; error: string };

const input = z.object({
  leadId: z.string().uuid(),
  subject: z.string().trim().min(1, "Add a subject.").max(300),
  body: z.string().trim().min(1, "Write a message.").max(20000),
});

export async function sendLeadEmail(leadId: string, subject: string, body: string): Promise<EmailResult> {
  const parsed = input.safeParse({ leadId, subject, body });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  try {
    const user = await assertUser();
    const [lead] = await db
      .select({ id: leads.id, email: leads.email, ownerId: leads.ownerId })
      .from(leads)
      .where(eq(leads.id, parsed.data.leadId))
      .limit(1);
    // Same answer for "missing" and "not yours" so ids cannot be probed.
    if (!lead || (!isAdminRole(user.role) && lead.ownerId !== user.id)) return { ok: false, error: "Lead not found." };
    if (!lead.email) return { ok: false, error: "This lead has no email address. Add one first." };

    try {
      const sent = await sendMail({
        userId: user.id,
        to: lead.email,
        subject: parsed.data.subject,
        html: textToHtml(parsed.data.body),
      });
      await db.insert(emails).values({
        leadId: lead.id,
        userId: user.id,
        toAddress: lead.email,
        subject: parsed.data.subject,
        body: parsed.data.body,
        zohoMessageId: sent.messageId,
        status: "sent",
      });
      await audit(user.id, "email.send", lead.id, { to: lead.email });
    } catch (e) {
      const message = e instanceof ZohoError ? e.message : "Could not send the email.";
      await db.insert(emails).values({
        leadId: lead.id,
        userId: user.id,
        toAddress: lead.email,
        subject: parsed.data.subject,
        body: parsed.data.body,
        status: "failed",
        error: message,
      });
      revalidatePath("/ivr");
      revalidatePath("/ivr/admin/members");
      return { ok: false, error: message };
    }
    revalidatePath("/ivr");
    revalidatePath("/ivr/admin/members");
    return { ok: true };
  } catch (e) {
    if (e instanceof HttpError) return { ok: false, error: e.message };
    return { ok: false, error: "Could not send the email." };
  }
}

export async function disconnectZohoAction(): Promise<void> {
  const user = await assertUser();
  await disconnectZoho(user.id);
  await audit(user.id, "zoho.disconnect", user.id);
  revalidatePath("/ivr/connections");
}
