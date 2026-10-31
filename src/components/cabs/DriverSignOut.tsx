"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { cabsApi } from "./api";

/** Sign out, for a driver signed in by phone: ends their session and goes back to the driver sign-in. */
export function DriverSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const out = async () => {
    setPending(true);
    try { await cabsApi("/api/cabs/driver-logout", "POST"); } catch { /* the cookie is cleared by the answer; on a failure the session still ends in 12 hours */ }
    router.replace("/cabs/driver-login");
    router.refresh();
  };
  return (
    <button type="button" onClick={out} disabled={pending} className="flex min-h-14 w-full items-center gap-3 px-5 text-left text-base font-semibold text-brand-red hover:bg-[#f0f2f5]" data-driver-sign-out>
      <LogOut size={18} aria-hidden /> Sign out
    </button>
  );
}
