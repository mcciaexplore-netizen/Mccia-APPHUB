"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { cabsApi } from "./api";

const BUTTON = "min-h-12 w-full rounded-lg bg-[#1a2b4a] text-base font-bold text-white transition-opacity disabled:opacity-60";

/**
 * The drivers' sign-in, in two steps on one page. Step 1: their name and phone, and "Request Login" (a phone that is a driver's tells the
 * Cabs admins to make a login OTP). Step 2 appears below: the 6-digit OTP the admin gave them, and "Login". "← Back" returns to step 1.
 * The boxes open the right keypad on a phone. Signed in, it goes on to the driver app.
 */
export function DriverLoginForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const call = async (fn: () => Promise<void>) => {
    setError("");
    setPending(true);
    try { await fn(); } catch (err) { setError((err as Error).message); }
    setPending(false);
  };
  const request = (e: React.FormEvent) => { e.preventDefault(); void call(async () => { await cabsApi("/api/cabs/driver-access", "POST", { name, phone }); setOtp(""); setStep(2); }); };
  const login = (e: React.FormEvent) => {
    e.preventDefault();
    void call(async () => { await cabsApi("/api/cabs/driver-login", "POST", { phone, otp }); router.replace("/cabs/driver"); router.refresh(); });
  };
  const errorBox = error && <p className="rounded-lg bg-brand-red/10 px-3 py-2 text-sm font-semibold text-brand-red" role="alert" data-login-error>{error}</p>;
  return (
    <div className="space-y-5">
      <form className="space-y-4" onSubmit={request} noValidate data-step="1">
        <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">Name</span>
          <input className="input !min-h-12 !text-lg" name="name" autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)}
            disabled={step === 2} required autoFocus /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">Phone number</span>
          <input className="input !min-h-12 !text-lg" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" maxLength={20}
            value={phone} onChange={(e) => setPhone(e.target.value)} disabled={step === 2} required /></label>
        {step === 1 && errorBox}
        {step === 1 && <button className={BUTTON} disabled={pending || !name.trim() || !phone.trim()}>{pending ? "Checking…" : "Request Login"}</button>}
      </form>
      {step === 2 && (
        <form className="space-y-4 border-t border-black/5 pt-5" onSubmit={login} noValidate data-step="2">
          <p className="rounded-lg bg-[#2a6b7c]/10 px-3 py-2 text-sm font-semibold text-[#2a6b7c]" data-otp-requested>Your admin has been notified. Ask them for your 6-digit OTP.</p>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink">Enter the OTP your admin gave you</span>
            <input className="input !min-h-12 text-center font-mono !text-2xl tracking-[0.4em]" name="otp" type="text" inputMode="numeric" autoComplete="one-time-code"
              pattern="\d{6}" maxLength={6} placeholder="••••••" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} required autoFocus /></label>
          {errorBox}
          <button className={BUTTON} disabled={pending || otp.length !== 6}>{pending ? "Signing in…" : "Login"}</button>
          <button type="button" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-ink" onClick={() => { setStep(1); setError(""); }} data-back>
            <ChevronLeft size={16} aria-hidden /> Back</button>
        </form>
      )}
    </div>
  );
}
