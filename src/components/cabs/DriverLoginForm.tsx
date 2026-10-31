"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cabsApi } from "./api";

/**
 * The drivers' sign-in: their phone and the 6-digit OTP an admin gave them. Both boxes open the number keypad on a phone. Signed in, it
 * goes on to the driver app.
 */
export function DriverLoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await cabsApi("/api/cabs/driver-login", "POST", { phone, otp });
      router.replace("/cabs/driver");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };
  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">Phone number</span>
        <input className="input !min-h-12 !text-lg" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" maxLength={20}
          value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus /></label>
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">OTP</span>
        <input className="input !min-h-12 text-center font-mono !text-2xl tracking-[0.4em]" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code"
          pattern="\d{6}" maxLength={6} placeholder="••••••" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} required /></label>
      {error && <p className="rounded-lg bg-brand-red/10 px-3 py-2 text-sm font-semibold text-brand-red" role="alert" data-login-error>{error}</p>}
      <button className="min-h-12 w-full rounded-lg bg-[#1a2b4a] text-base font-bold text-white transition-opacity disabled:opacity-60"
        disabled={pending || !phone.trim() || otp.length !== 6}>{pending ? "Signing in…" : "Login"}</button>
    </form>
  );
}
