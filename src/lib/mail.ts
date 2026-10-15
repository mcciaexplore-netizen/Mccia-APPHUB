import "server-only";
import nodemailer from "nodemailer";

/**
 * Email for the hub itself (invitations). Uses the same SMTP settings as the Approval System: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * and SMTP_FROM. With no SMTP_HOST and SMTP_FROM nothing is sent and the caller is told, so the administrator can pass the link on
 * another way. A message that fails to send is logged without its contents and reported, never thrown.
 */
export type MailResult = "sent" | "failed" | "not_configured";

type Transport = ReturnType<typeof nodemailer.createTransport>;
let transport: Transport | undefined;

const mailConfigured = () => !!(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());

function getTransport(): Transport {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST!.trim(), port, secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    });
  }
  return transport;
}

export async function sendMail(to: string, subject: string, html: string): Promise<MailResult> {
  if (!mailConfigured()) return "not_configured";
  try {
    await getTransport().sendMail({ from: process.env.SMTP_FROM!.trim(), to, subject, html });
    return "sent";
  } catch (e) {
    console.error("[hub] could not send email:", e instanceof Error ? e.message : "unknown error"); // never the message body: it holds a link
    return "failed";
  }
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
