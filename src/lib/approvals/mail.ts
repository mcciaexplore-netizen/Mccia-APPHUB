import "server-only";
import nodemailer from "nodemailer";

/**
 * The module's one door to email. Configured by SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM (see .env.example).
 * Without SMTP_HOST and SMTP_FROM nothing is sent and the call returns false: the in-app bell still works, so a missing mail
 * setup never stops a request from being submitted or decided. A send that fails is logged and returns false, never throws.
 */

type Transport = ReturnType<typeof nodemailer.createTransport>;
let transport: Transport | undefined;
let warned = false;

const configured = () => !!(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());

function getTransport(): Transport {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST!.trim(),
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    });
  }
  return transport;
}

export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!configured()) {
    if (!warned) { warned = true; console.info("[approvals] SMTP is not configured (SMTP_HOST, SMTP_FROM), so emails are skipped."); }
    return false;
  }
  try {
    await getTransport().sendMail({ from: process.env.SMTP_FROM!.trim(), to, subject, html });
    return true;
  } catch (e) {
    console.error("[approvals] could not send email", e instanceof Error ? e.message : e);
    return false;
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** An absolute link to a page of the module when APP_BASE_URL is set, otherwise just the path. */
export const absoluteLink = (path: string) => `${(process.env.APP_BASE_URL ?? "").trim().replace(/\/$/, "")}${path}`;

/** The same simple layout for every message: a heading, a few lines of detail and one button. Every value is escaped. */
export function mailHtml(heading: string, lines: string[], link?: { label: string; href: string }): string {
  const body = lines.map((l) => `<p style="margin:0 0 8px;color:#333;font-size:14px;line-height:1.5">${escapeHtml(l)}</p>`).join("");
  const button = link
    ? `<p style="margin:18px 0 0"><a href="${escapeHtml(link.href)}" style="background:#1abc9c;color:#fff;text-decoration:none;padding:9px 18px;border-radius:3px;font-size:14px">${escapeHtml(link.label)}</a></p>`
    : "";
  return `<div style="font-family:Lato,Arial,sans-serif;max-width:520px"><h2 style="margin:0 0 14px;font-size:18px;color:#222">${escapeHtml(heading)}</h2>${body}${button}</div>`;
}
