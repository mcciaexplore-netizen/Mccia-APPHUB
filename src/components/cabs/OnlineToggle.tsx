"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { cabsApi } from "./api";

/** The driver's Online/Offline switch: green "Online" (rides can be assigned to them), grey "Offline" (no new rides). */
export function OnlineToggle({ online }: { online: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(online);
  const flip = () => start(async () => {
    const next = !on;
    setOn(next);
    try { await cabsApi("/api/cabs/driver/availability", "POST", { available: next }); toast.success(next ? "You're online: rides can be assigned to you" : "You're offline: no new rides will be assigned"); router.refresh(); }
    catch (e) { setOn(!next); toast.error((e as Error).message); }
  });
  return (
    <button type="button" onClick={flip} disabled={pending} aria-pressed={on} data-online={on}
      className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors ${on ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#e5e7eb] text-[#4b5563]"}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${on ? "bg-[#16a34a]" : "bg-[#9ca3af]"}`} aria-hidden />{on ? "Online" : "Offline"}
    </button>
  );
}
