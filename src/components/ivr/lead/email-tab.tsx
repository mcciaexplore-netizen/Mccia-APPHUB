"use client";

import { useState, useTransition } from "react";
import { sendLeadEmail } from "@/lib/ivr/actions/email";
import { formatIst } from "@/lib/ivr/time";
import { Alert, Badge } from "@/components/ivr/ui";

type SentEmail = {
  id: string;
  subject: string;
  body: string;
  toAddress: string;
  status: string;
  error: string | null;
  sentAt: Date;
  userName: string | null;
};

export function EmailTab(props: {
  lead: { id: string; name: string; email: string | null };
  emails: SentEmail[];
  zohoConnected: boolean;
}) {
  const { lead, emails, zohoConnected } = props;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    start(async () => {
      const r = await sendLeadEmail(lead.id, subject, body);
      if (r.ok) {
        setSubject("");
        setBody("");
        setResult({ ok: true, message: `Sent to ${lead.email}.` });
      } else {
        setResult({ ok: false, message: r.error });
      }
    });
  }

  return (
    <div className="grid gap-4">
      {!zohoConnected ? (
        <div className="ivr-card grid gap-3 p-6">
          <p className="font-semibold">Connect Zoho Mail to send from here</p>
          <p className="text-[13px] text-muted">
            Emails go out from your own Zoho mailbox and are logged on this lead.
          </p>
          <a href="/api/ivr/zoho/connect" className="btn btn-primary w-fit">
            Connect Zoho Mail
          </a>
        </div>
      ) : !lead.email ? (
        <div className="ivr-card p-6">
          <p className="font-semibold">No email address for {lead.name}</p>
          <p className="text-[13px] text-muted">Add an email in the Details tab, then you can write to them here.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="ivr-card grid gap-4 p-6">
          <div className="grid gap-1">
            <span className="ivr-label">To</span>
            <p className="font-mono text-[13px]">{lead.email}</p>
          </div>
          <div className="grid gap-1">
            <label htmlFor={`mail-subject-${lead.id}`} className="ivr-label">
              Subject
            </label>
            <input
              id={`mail-subject-${lead.id}`}
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
              required
            />
          </div>
          <div className="grid gap-1">
            <label htmlFor={`mail-body-${lead.id}`} className="ivr-label">
              Message
            </label>
            <textarea
              id={`mail-body-${lead.id}`}
              className="input min-h-36 resize-y"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send email"}
            </button>
            {result && (
              <Alert kind={result.ok ? "success" : "error"} role={result.ok ? "status" : "alert"} className="px-3 py-2">
                {result.message}
              </Alert>
            )}
          </div>
        </form>
      )}

      <div className="grid gap-2">
        <h4 className="ivr-label">Sent mail</h4>
        {emails.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing sent to this lead yet.</p>
        ) : (
          <ul className="grid gap-2">
            {emails.map((m) => {
              const failed = m.status === "failed";
              const color = failed ? "var(--ivr-missed)" : "var(--ivr-done)";
              return (
                <li key={m.id} className="ivr-card grid gap-1 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{m.subject}</span>
                    <Badge color={color}>{m.status}</Badge>
                  </div>
                  <p className="text-[12px] text-muted">
                    {m.userName ?? "Someone"} to {m.toAddress} · {formatIst(m.sentAt)}
                  </p>
                  {failed && m.error && <p className="text-[12px] text-brand-red">{m.error}</p>}
                  <p className="line-clamp-3 text-[13px] whitespace-pre-line">{m.body}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
