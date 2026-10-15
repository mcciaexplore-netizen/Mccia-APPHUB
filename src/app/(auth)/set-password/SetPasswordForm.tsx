"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { finishSetup } from "@/actions/invite";

export function SetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) return setError("The two passwords do not match.");
    setError(null);
    start(async () => {
      const r = await finishSetup({ token, password, again });
      if (r.ok) router.replace("/login?set=1");
      else setError(r.error);
    });
  }

  return (
    <form className="mt-7 space-y-3" onSubmit={submit}>
      {error && <div role="alert" className="alert alert-red"><AlertCircle size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
      <label className="block"><span className="label-xs mb-1.5 block">New password</span>
        <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} maxLength={128} autoFocus /></label>
      <label className="block"><span className="label-xs mb-1.5 block">Repeat the password</span>
        <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></label>
      <p className="text-xs text-subtle">At least 10 characters, with a letter and a number.</p>
      <button className="btn btn-primary w-full" disabled={pending}>Save password and continue</button>
    </form>
  );
}
