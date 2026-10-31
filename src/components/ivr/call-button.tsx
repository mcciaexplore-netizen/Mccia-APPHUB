"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Phone, PhoneOutgoing } from "lucide-react";
import { cx as clsx } from "@/lib/ivr/cx";
import { placeCall } from "@/lib/ivr/actions/leads";

/**
 * The direct Call button. Smartflo rings the agent's phone first, then connects the member.
 * Used on every member row, in the side panel, on pipeline cards and in the queue.
 */
export function CallButton({
  leadId,
  disabled,
  size = "sm",
  label,
  callBack,
  onResult,
  className,
}: {
  leadId: string;
  disabled?: boolean;
  size?: "sm" | "md";
  label?: string;
  /** The member phoned us and nobody picked up: the button says "Call back" so it is clear why we are ringing them. */
  callBack?: boolean;
  onResult?: (r: { ok: boolean; text: string }) => void;
  className?: string;
}) {
  const router = useRouter();
  const text = label ?? (callBack ? "Call back" : "Call");
  const Icon = callBack ? PhoneOutgoing : Phone;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);

  const press = (e: React.MouseEvent) => {
    e.stopPropagation();
    start(async () => {
      const r = await placeCall(leadId);
      const m = { ok: r.ok, text: r.ok ? (r.message ?? "Calling") : r.error };
      setMsg(m);
      onResult?.(m);
      if (r.ok) router.refresh();
    });
  };

  return (
    <span className="inline-flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={clsx("btn btn-primary", size === "sm" && "btn-sm", className)}
        disabled={disabled || pending}
        onClick={press}
        title={callBack ? "This member called and was missed. Smartflo rings you first, then connects them" : "Smartflo rings your phone first, then connects the member"}
        aria-label={text}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden /> {pending ? "Dialing…" : text}
      </button>
      {msg && !onResult && (
        <span role={msg.ok ? "status" : "alert"} className={clsx("max-w-[240px] text-[11px] leading-snug", msg.ok ? "text-brand-green-text" : "text-brand-red")}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
