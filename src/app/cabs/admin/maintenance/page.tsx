import Link from "next/link";
import { Download } from "lucide-react";
import { MaintenanceView } from "@/components/cabs/MaintenanceView";
import { MAINTENANCE_LABEL, MAINTENANCE_TYPES } from "@/lib/cabs/cabs.manifest";
import { requireAdminPage } from "@/lib/cabs/guard";
import { listMaintenance } from "@/lib/cabs/maintenance";
import { listVehicles } from "@/lib/cabs/vehicles";
import { istToday } from "@/lib/cabs/validation";

export const metadata = { title: "Maintenance · Cabs Admin · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Vehicle maintenance records, filtered by vehicle, type and date; add, edit, delete; CSV. */
export default async function MaintenancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const f = { vehicleId: one(sp.vehicle), type: one(sp.type), from: one(sp.from), to: one(sp.to) };
  const [records, vehicles] = await Promise.all([listMaintenance(f), listVehicles()]);
  const today = istToday();
  const query = new URLSearchParams({ ...(f.vehicleId && { vehicle: f.vehicleId }), ...(f.type && { type: f.type }), ...(f.from && { from: f.from }), ...(f.to && { to: f.to }) }).toString();
  const filtered = Object.values(f).some(Boolean);
  return (
    <div className="page-enter space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl">Maintenance</h1><p className="text-sm text-muted">Services, repairs, inspections and cleaning. A next due date that has passed shows in red.</p></div>
        <a href={`/api/cabs/maintenance/export?${query}`} className="btn btn-ghost btn-sm"><Download size={14} /> Export CSV</a>
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get" action="/cabs/admin/maintenance">
        <label className="block"><span className="label-xs mb-1.5 block">Vehicle</span>
          <select name="vehicle" className="input !w-auto" defaultValue={f.vehicleId}><option value="">All</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.numberPlate}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">Type</span>
          <select name="type" className="input !w-auto" defaultValue={f.type}><option value="">All</option>{MAINTENANCE_TYPES.map((t) => <option key={t} value={t}>{MAINTENANCE_LABEL[t]}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">From</span><input type="date" name="from" className="input !w-auto" defaultValue={f.from} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">To</span><input type="date" name="to" className="input !w-auto" defaultValue={f.to} /></label>
        <button className="btn btn-primary btn-sm">Show</button>
        {filtered && <Link href="/cabs/admin/maintenance" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      <MaintenanceView today={today} vehicles={vehicles.map((v) => ({ id: v.id, numberPlate: v.numberPlate, model: v.model, isActive: v.isActive }))}
        records={records.map((r) => ({ ...r, doneAt: r.doneAt.toISOString(), nextDueAt: r.nextDueAt ? r.nextDueAt.toISOString() : null }))} />
    </div>
  );
}
