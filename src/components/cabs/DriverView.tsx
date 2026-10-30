"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckCircle2, Play } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { cabsApi } from "./api";
import { RideCard, type RideView } from "./RideCard";

/** A driver's rides: Start on an assigned one, Complete on the one under way. Past rides have no buttons. */
export function DriverView({ rides, empty }: { rides: RideView[]; empty: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const act = async (r: RideView, step: "start" | "complete") => {
    if (step === "complete" && !(await confirm({ title: "Complete this ride?", message: `${r.pickup} → ${r.dropoff}. ${r.requestedByName} will be told it is complete.`, confirmLabel: "Complete" }))) return;
    start(async () => {
      try { await cabsApi(`/api/cabs/rides/${r.id}/${step}`, "POST"); toast.success(step === "start" ? "Ride started" : "Ride completed"); router.refresh(); } catch (e) { toast.error((e as Error).message); }
    });
  };
  if (!rides.length) return <p className="text-sm text-subtle">{empty}</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rides.map((r) => (
        <RideCard key={r.id} ride={r} showRequester actions={
          r.status === "assigned" ? <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => act(r, "start")}><Play size={14} /> Start Ride</button>
            : r.status === "in_progress" ? <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => act(r, "complete")}><CheckCircle2 size={14} /> Complete Ride</button>
              : undefined} />
      ))}
    </div>
  );
}
