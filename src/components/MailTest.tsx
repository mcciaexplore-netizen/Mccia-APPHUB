"use client";

import { useTransition } from "react";
import { Mail } from "lucide-react";
import { sendTestEmail } from "@/actions/mail";
import { useToast } from "@/components/Toast";

/** The Support Admin's check that email (Zoho) works: what is set up, and a button that sends a test to themselves. */
export function MailTest({ status }: { status: { configured: boolean; host: string; port: string; from: string; user: string } }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <section className="glass !rounded-md mb-6 space-y-3 p-5" aria-label="Email">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg">Email (Zoho)</h3>
          <p className="text-sm text-muted">{status.configured ? `Sending through ${status.host}:${status.port} as ${status.from}${status.user ? ` (signed in as ${status.user})` : ""}.` : "Not set up yet: emails are not being sent."}</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => {
          const r = await sendTestEmail();
          if (r.ok) toast.success(`Test email sent to ${r.data.to}. Check your inbox.`); else toast.error(r.error);
        })}><Mail size={14} /> {pending ? "Sending…" : "Send test email to me"}</button>
      </div>
    </section>
  );
}
