"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMembershipLinesAction } from "@/lib/ivr/actions/admin";
import { Alert } from "@/components/ivr/ui";

/** Which calls in the shared Smartflo account belong to Membership. */
export function MembershipScope({ initial, mappedAgents }: { initial: string[]; mappedAgents: number }) {
  const router = useRouter();
  const [text, setText] = useState(initial.join("\n"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="ivr-card grid gap-3 p-6 sm:p-8">
      <div>
        <h2 className="text-xl">Membership scope</h2>
        <p className="text-[13px] text-muted">
          Your Smartflo account is shared with other departments, so this CRM only keeps Membership calls. A call is kept when an agent linked to a
          IVR-CRM agent handled it ({mappedAgents} linked now), or when it came in on one of the phone lines below. Everything else is ignored and is
          never deleted from Smartflo.
        </p>
      </div>
      {initial.length === 0 && (
        <Alert kind="info">
          No Membership phone line is set. Missed inbound calls that no agent picked up will be ignored until you add the Membership number(s).
        </Alert>
      )}
      <form
        className="grid max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveMembershipLinesAction(text);
            setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Saved") : r.error });
            if (r.ok) router.refresh();
          });
        }}
      >
        <label className="grid gap-1 ivr-label">
          Membership phone lines (the numbers members call or see). One per line.
          <textarea className="input min-h-24 font-mono font-normal text-ink" value={text} onChange={(e) => setText(e.target.value)} placeholder="+91 20 7100 0000" />
        </label>
        <div>
          <button className="btn btn-primary btn-sm" disabled={pending}>
            Save lines
          </button>
        </div>
      </form>
      {msg && (
        <Alert kind={msg.ok ? "success" : "error"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </Alert>
      )}
    </section>
  );
}
