"use server";

import { adminAction } from "@/lib/action";
import { escapeHtml, sendMail } from "@/lib/mail";
import { UserError } from "@/lib/user-error";

/**
 * Sends a test email to the Support Admin through the hub's mail settings (the Support Admin's Zoho mailbox), to prove the connection
 * works before people rely on it. Only the Support Admin. Nothing secret is returned: a failure says what to check, never the password.
 */
export async function sendTestEmail() {
  return adminAction(async (admin) => {
    const result = await sendMail(admin.email, "MCCIA App Hub: test email",
      `<div style="font-family:Arial,sans-serif;max-width:520px"><h2 style="margin:0 0 14px">Email is working</h2>
       <p>Hello ${escapeHtml(admin.name)},</p><p>This test came from the MCCIA App Hub through its mail settings. New users will get their sign-in details this way, and approval notifications too.</p></div>`);
    if (result === "not_configured") throw new UserError("Email is not set up: add SMTP_HOST and SMTP_FROM (and SMTP_USER, SMTP_PASS, SMTP_PORT) in Vercel, then redeploy.");
    if (result === "failed") throw new UserError("Zoho refused the email. Check SMTP_USER (your Zoho address), SMTP_PASS (a Zoho app password, not your normal password), SMTP_HOST smtp.zoho.in and SMTP_PORT 465, then redeploy.");
    return { to: admin.email };
  });
}
