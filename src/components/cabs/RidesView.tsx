"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { cabsApi } from "./api";
import { RideCard, type RideView } from "./RideCard";

/** Someone's own rides, each a white card; a pending one can be cancelled by them. */
export function RidesView({ rides, empty }: { rides: RideView[]; empty: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const cancel = async (r: RideView) => {
    // Asked before the transition starts: a dialog opened inside one never shows.
    if (!(await confirm({ title: "Cancel this ride?", message: `${r.pickup} → ${r.dropoff}. This can't be undone.`, confirmLabel: "Cancel ride", danger: true }))) return;
    start(async () => {
      try { await cabsApi(`/api/cabs/rides/${r.id}/cancel`, "POST", {}); toast.success("Ride cancelled"); router.refresh(); } catch (e) { toast.error((e as Error).message); }
    });
  };
  if (!rides.length) return <p className="rounded-xl bg-white p-6 text-center text-sm text-subtle shadow-sm">{empty}</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rides.map((r) => (
        <RideCard key={r.id} ride={r} actions={r.status === "pending" ? <button className="inline-flex min-h-12 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-brand-red hover:bg-red-tint" disabled={pending} onClick={() => cancel(r)}><X size={16} /> Cancel</button> : undefined} />
      ))}
    </div>
  );
}
