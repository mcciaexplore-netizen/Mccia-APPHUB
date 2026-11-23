import { PAYMENT_DESK_ORIGIN } from "@/lib/paymentdesk/paymentdesk.manifest";

/**
 * Payment Desk inside the hub: its site in a frame filling the space under the top bar (the screen height minus the 64px bar), and a small
 * faint "Open in new tab ↗" link floating in the bottom right corner, for when the frame does not load (a blocked third-party cookie, a
 * network that stops it). No sandbox on the frame: Payment Desk needs its own sign-in, storage and downloads.
 */
export function PaymentDeskFrame({ src }: { src: string }) {
  return (
    <div data-testid="payment-desk">
      <iframe
        src={src}
        title="Payment Desk"
        allow="clipboard-write"
        className="block h-[calc(100vh-64px)] w-full border-0 supports-[height:100dvh]:h-[calc(100dvh-64px)]"
      />
      <a
        href={PAYMENT_DESK_ORIGIN}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="payment-desk-newtab"
        className="fixed right-4 bottom-4 z-10 text-xs text-[#9CA3AF] no-underline opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      >
        Open in new tab ↗
      </a>
    </div>
  );
}
