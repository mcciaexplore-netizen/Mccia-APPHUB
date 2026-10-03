"use client";

import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { changePassword } from "@/actions/auth";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    if (next !== again) return setError("The new passwords do not match.");
    setError(null);
    start(async () => {
      const r = await changePassword({ current, next });
      if (r.ok) { setDone(true); setCurrent(""); setNext(""); setAgain(""); } else setError(r.error);
    });
  }

  return (
    <form className="mt-7 space-y-3" onSubmit={submit}>
      {error && <div role="alert" className="alert alert-red"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
      {done && <div role="status" className="alert alert-green"><CheckCircle2 size={18} className="mt-0.5 shrink-0" /><span>Password changed.</span></div>}
      <label className="block"><span className="label-xs mb-1.5 block">Current password</span>
        <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
      <label className="block"><span className="label-xs mb-1.5 block">New password</span>
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} maxLength={128} /></label>
      <label className="block"><span className="label-xs mb-1.5 block">Repeat new password</span>
        <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
      <p className="text-xs text-subtle">At least 10 characters, with a letter and a number.</p>
      <button className="btn btn-primary w-full" disabled={pending}>Save password</button>
    </form>
  );
}
