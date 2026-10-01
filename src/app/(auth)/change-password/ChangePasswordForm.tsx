"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { changePassword } from "@/actions/account";

export function ChangePasswordForm({ cancelHref, signOutAction, done }: {
  cancelHref: string | null; signOutAction: () => Promise<void>; done: () => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return setError("The new passwords do not match.");
    setError(null);
    start(async () => {
      const r = await changePassword({ current, next });
      if (r.ok) await done();
      else setError(r.error);
    });
  }

  return (
    <>
      <form className="mt-7 space-y-3" onSubmit={submit}>
        {error && (
          <div role="alert" className="alert alert-red"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>
        )}
        <label className="block"><span className="label-xs mb-1.5 block">Current password</span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label className="block"><span className="label-xs mb-1.5 block">New password</span>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} maxLength={72} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">Repeat new password</span>
          <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
        <p className="text-xs text-subtle">At least 10 characters, with a letter and a number.</p>
        <button className="btn btn-primary w-full" disabled={pending}>Save password</button>
      </form>
      <div className="mt-4 text-center text-sm">
        {cancelHref ? <Link href={cancelHref} className="text-muted hover:text-primary">Cancel</Link> : (
          <form action={signOutAction}><button className="text-muted hover:text-primary">Sign out</button></form>
        )}
      </div>
    </>
  );
}
