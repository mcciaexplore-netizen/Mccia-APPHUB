"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { setMyEmailAction } from "@/lib/design/actions/tickets";

/** The designer's own switch for DesignDesk emails (the hub bell always gets the notice). */
export function EmailSwitch({ email, enabled }: { email: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const flip = () =>
    start(async () => {
      const r = await setMyEmailAction(!on);
      if (!r.ok) return toast.error(r.error);
      setOn(!on);
      toast.success(r.message ?? "Saved");
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink">
        Emails about your tickets go to <strong>{email}</strong>.
      </p>
      <button type="button" role="switch" aria-checked={on} aria-label="DesignDesk emails" disabled={pending} onClick={flip} className="flex items-center gap-2 text-sm font-semibold">
        <span className={`relative inline-block h-6 w-11 rounded-full transition-colors ${on ? "bg-[var(--ds-green)]" : "bg-gray-300"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
        </span>
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}
