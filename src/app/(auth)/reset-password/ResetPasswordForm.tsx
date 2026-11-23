"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertCircle, Check, CheckCircle2, Circle } from "lucide-react";
import { resetPassword } from "@/actions/password-reset";
import { PasswordInput } from "@/components/PasswordInput";
import { PASSWORD_RULES } from "@/lib/password-reset-rules";

/**
 * Always rendered by the page, valid link or not, so that it keeps its state when the page re-renders: a successful reset signs this
 * browser out, which re-renders the page with the link now used up, and "Password reset successfully!" must stay on screen.
 */
export function ResetPasswordForm({ token, valid }: { token: string; valid: boolean }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) return setError("The two passwords do not match.");
    const unmet = PASSWORD_RULES.find((r) => !r.test(password));
    if (unmet) return setError(`The password needs: ${unmet.label.toLowerCase()}.`);
    setError(null);
    start(async () => {
      const r = await resetPassword({ token, password, again });
      if (r.ok) setDone(true);
      else if (r.expired) setExpired(true);
      else setError(r.error);
    });
  }

  if (done)
    return (
      <div className="mt-6 space-y-5" data-testid="reset-done">
        <div role="status" className="alert alert-green text-left">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>Password reset successfully! You can now sign in with your new password.</span>
        </div>
        <Link href="/login" className="btn btn-primary w-full">Go to sign in</Link>
      </div>
    );

  if (expired || !valid) return <ExpiredLink />;

  return (
    <form className="mt-7 space-y-3 text-left" onSubmit={submit}>
      {error && <div role="alert" className="alert alert-red"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
      <label className="block">
        <span className="label-xs mb-1.5 block">New password</span>
        <PasswordInput name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} autoFocus />
      </label>
      <label className="block">
        <span className="label-xs mb-1.5 block">Confirm password</span>
        <PasswordInput name="again" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required maxLength={128} />
      </label>
      <ul className="space-y-1 text-xs" aria-label="Password requirements" data-testid="password-rules">
        {PASSWORD_RULES.map((r) => {
          const met = r.test(password);
          return (
            <li key={r.label} className={`flex items-center gap-1.5 ${met ? "text-brand-green-text" : "text-subtle"}`}>
              {met ? <Check size={13} aria-hidden /> : <Circle size={11} aria-hidden />}
              {r.label}
              <span className="sr-only">{met ? " (met)" : " (not met yet)"}</span>
            </li>
          );
        })}
      </ul>
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Reset password"}</button>
    </form>
  );
}

function ExpiredLink() {
  return (
    <div role="alert" className="alert alert-red mt-6 text-left" data-testid="reset-expired">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      <span>
        This reset link has expired or is invalid.{" "}
        <Link href="/forgot-password" className="font-semibold underline">Request a new one →</Link>
      </span>
    </div>
  );
}
