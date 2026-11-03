"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { formatDateTime } from "@/lib/approvals/format";

/** Opens the browser's print dialog for the request on the page; the print styles (approvals.css) leave only the request on paper. */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-ghost btn-sm apr-no-print" onClick={() => window.print()}>
      <Printer size={15} aria-hidden /> Print
    </button>
  );
}

/** "Printed on …" at the foot of the printed page: set the moment printing starts (the button or Ctrl+P), not when the page loaded. */
export function PrintedOn({ by }: { by: string }) {
  const [at, setAt] = useState<Date | null>(null);
  useEffect(() => {
    const stamp = () => setAt(new Date());
    window.addEventListener("beforeprint", stamp);
    return () => window.removeEventListener("beforeprint", stamp);
  }, []);
  // The server and the browser render seconds apart; the time is only read on paper, after the beforeprint stamp.
  return <p suppressHydrationWarning>Printed on {formatDateTime(at ?? new Date())} by {by} · MCCIA App Hub, Approval System</p>;
}
