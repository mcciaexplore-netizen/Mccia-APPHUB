"use client";

import { useState } from "react";
import { useToast } from "@/components/Toast";
import { api, useAction } from "@/components/approvals/api";
import { Field } from "@/components/approvals/shared-ui";
import { formatINR, parseINR } from "@/lib/approvals/format";
import type { ApprovalsSettings } from "@/lib/approvals/settings";

const TOGGLES: { key: "largeFormShowQuotation" | "notifyApproverOnAssignment" | "notifyRequesterOnOutcome" | "notifyAdminOnImportErrors"; label: string; hint: string }[] = [
  { key: "largeFormShowQuotation", label: "Show the Quotation upload on the Expenditure (10,000 and above) form", hint: "An optional extra file field after Tax Invoice / Supporting Documents." },
  { key: "notifyApproverOnAssignment", label: "Email the approver when a request is assigned to them", hint: "Reminders for requests left waiting are controlled by the hours above." },
  { key: "notifyRequesterOnOutcome", label: "Email the requester on every step outcome and the final result", hint: "Submission confirmations are always sent." },
  { key: "notifyAdminOnImportErrors", label: "Email Approvals admins when an import has errors", hint: "" },
];

export function SettingsForm({ initial }: { initial: ApprovalsSettings }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const [threshold, setThreshold] = useState(formatINR(initial.thresholdPaise));
  const [hours, setHours] = useState(String(initial.reminderAfterHours));
  const [flags, setFlags] = useState({
    largeFormShowQuotation: initial.largeFormShowQuotation,
    notifyApproverOnAssignment: initial.notifyApproverOnAssignment,
    notifyRequesterOnOutcome: initial.notifyRequesterOnOutcome,
    notifyAdminOnImportErrors: initial.notifyAdminOnImportErrors,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const thresholdPaise = parseINR(threshold);
    if (thresholdPaise === null) return toast.error("Enter the threshold as an amount like 10,000.00");
    run(() => api("PUT", "/api/approvals/settings", { thresholdPaise, reminderAfterHours: Math.trunc(Number(hours)), ...flags }), "Settings saved");
  };

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-6">
      <Field label="Threshold for the DG step" hint="An expense of this amount or more goes on to the Super Admin (the DG) after the Expense Admin. It is the same form at every amount. Requests already submitted keep the route they were given.">
        <div className="relative w-56">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-subtle">{"₹"}</span>
          <input className="input !pl-8" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} required />
        </div>
      </Field>
      <Field label="Remind the approver after (hours)" hint="A request still waiting after this long gets a reminder email, once a day.">
        <input className="input w-32" type="number" min={1} max={720} value={hours} onChange={(e) => setHours(e.target.value)} required />
      </Field>
      <div className="space-y-3">
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={flags[t.key]} onChange={(e) => setFlags((f) => ({ ...f, [t.key]: e.target.checked }))} />
            <span className="text-sm"><b>{t.label}</b>{t.hint && <span className="block text-xs text-muted">{t.hint}</span>}</span>
          </label>
        ))}
      </div>
      <button className="btn btn-primary btn-sm" disabled={pending}>Save settings</button>
    </form>
  );
}
