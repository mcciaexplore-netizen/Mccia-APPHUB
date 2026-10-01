"use client";

import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { setInitialPassword } from "@/actions/account";

export function SetPasswordForm({ signOutAction, done }: { signOutAction: () => Promise<void>; done: () => Promise<void> }) {
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== again) return setError("The passwords do not match.");
    setError(null);
    start(async () => {
      const r = await setInitialPassword({ next });
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
        <label className="block"><span className="label-xs mb-1.5 block">New password</span>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} maxLength={72} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">Repeat password</span>
          <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
        <p className="text-xs text-subtle">At least 10 characters, with a letter and a number.</p>
        <button className="btn btn-primary w-full" disabled={pending}>Save password</button>
      </form>
      <form action={signOutAction} className="mt-4 text-center text-sm"><button className="text-muted hover:text-primary">Sign out</button></form>
    </>
  );
}
