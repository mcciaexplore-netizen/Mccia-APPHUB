"use client";

import { useState, useTransition } from "react";
import { AlertCircle, MailCheck } from "lucide-react";
import { sendResetLink } from "@/actions/password-reset";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await sendResetLink({ email });
      if (r.ok) setDone(true);
      else setError(r.error);
    });
  }

  if (done)
    return (
      <div role="status" className="alert alert-green mt-6 text-left" data-testid="reset-sent">
        <MailCheck size={18} className="mt-0.5 shrink-0" />
        <span>If this email is registered, you&apos;ll receive a reset link shortly. Check your inbox.</span>
      </div>
    );

  return (
    <form className="mt-7 space-y-3 text-left" onSubmit={submit}>
      {error && <div role="alert" className="alert alert-red"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
      <label className="block">
        <span className="label-xs mb-1.5 block">Email</span>
        <input name="email" type="email" inputMode="email" className="input" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={320} autoFocus />
      </label>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}
