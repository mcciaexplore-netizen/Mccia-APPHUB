import { VehiclesView } from "@/components/cabs/VehiclesView";
import { requireAdminPage } from "@/lib/cabs/guard";
import { maintenanceByVehicle } from "@/lib/cabs/maintenance";
import { listVehicles } from "@/lib/cabs/vehicles";
import { istToday } from "@/lib/cabs/validation";

export const metadata = { title: "Vehicles · Cabs Admin · MCCIA App Hub" };

export default async function VehiclesPage() {
  await requireAdminPage();
  const [vehicles, upkeep] = await Promise.all([listVehicles(), maintenanceByVehicle()]);
  const today = istToday();
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Vehicles</h1><p className="text-sm text-muted">The fleet. Only active vehicles can be given rides; an inactive one keeps its history and can be made active again.</p></div>
      <VehiclesView today={today} vehicles={vehicles.map((v) => {
        const m = upkeep.get(v.id);
        return { ...v, lastMaintenanceAt: m ? m.lastAt.toISOString() : null, nextDueAt: m?.nextDueAt ? m.nextDueAt.toISOString() : null };
      })} />
    </div>
  );
}
