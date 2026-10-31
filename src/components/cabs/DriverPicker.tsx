"use client";

import { usePathname, useRouter } from "next/navigation";
import { Eye } from "lucide-react";

export type DriverChoice = { id: string; name: string; isAvailable: boolean };

/**
 * For Cabs admins on the driver app: "Viewing as: [driver] ▼", to see the app as that driver would. Kept in the address (?driver=), so it
 * stays on as the tabs change. Nothing can be done from the preview: only the driver starts and completes their rides.
 */
export function DriverPicker({ drivers, selected }: { drivers: DriverChoice[]; selected: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <section className="space-y-2 rounded-xl border border-dashed border-[#2a6b7c]/40 bg-white p-4 shadow-sm" aria-label="Admin view" data-driver-picker>
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-[#2a6b7c]"><Eye size={14} aria-hidden /> Admin view — select a driver to preview</p>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span className="shrink-0">Viewing as:</span>
        <select className="input min-h-11 flex-1 text-base" name="viewAsDriver" value={selected} onChange={(e) => router.push(e.target.value ? `${pathname}?driver=${e.target.value}` : pathname)}>
          <option value="">Choose a driver</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.isAvailable ? "" : " (offline)"}</option>)}
        </select>
      </label>
    </section>
  );
}
