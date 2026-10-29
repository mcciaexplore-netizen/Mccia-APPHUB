import type { PoStatus } from "@/lib/inventory/po-number";

/** How each purchase order status is shown. */
export const PO_BADGE: Record<PoStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "badge badge-neutral" },
  sent: { label: "Sent", cls: "badge badge-purple" },
  received: { label: "Received", cls: "badge badge-green" },
  cancelled: { label: "Cancelled", cls: "badge badge-red" },
};
