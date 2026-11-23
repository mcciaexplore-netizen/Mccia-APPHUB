"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { PAYMENT_DESK_ORIGIN } from "@/lib/paymentdesk/paymentdesk.manifest";

/**
 * Payment Desk inside the hub: its site in a frame filling the space under the top bar, with a small line above it for when the frame does
 * not load (a blocked third-party cookie, a network that stops it), which opens Payment Desk in its own tab; it can be closed. No sandbox
 * on the frame: Payment Desk needs its own sign-in, storage and downloads.
 */
export function PaymentDeskFrame({ src }: { src: string }) {
  const [help, setHelp] = useState(true);
  return (
    <div className="flex h-[calc(100vh-64px)] flex-col supports-[height:100dvh]:h-[calc(100dvh-64px)]" data-testid="payment-desk">
      {help && (
        <p className="flex items-center justify-between gap-3 border-b border-line bg-alt px-5 py-1.5 text-xs text-muted sm:px-8 lg:px-12" data-testid="payment-desk-help">
          <span>
            Having trouble loading?{" "}
            <a href={PAYMENT_DESK_ORIGIN} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">
              Open Payment Desk in new tab →
            </a>
          </span>
          <button type="button" onClick={() => setHelp(false)} className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:text-ink" aria-label="Hide this message">
            <X size={14} aria-hidden />
          </button>
        </p>
      )}
      <iframe src={src} title="Payment Desk" allow="clipboard-write" className="block w-full min-h-0 flex-1 border-0" />
    </div>
  );
}
