import { VehiclesView } from "@/components/cabs/VehiclesView";
import { requireAdminPage } from "@/lib/cabs/guard";
import { listVehicles } from "@/lib/cabs/vehicles";

export const metadata = { title: "Vehicles · Cabs Admin · MCCIA App Hub" };

export default async function VehiclesPage() {
  await requireAdminPage();
  const vehicles = await listVehicles();
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Vehicles</h1><p className="text-sm text-muted">The fleet. Only active vehicles can be given rides; an inactive one keeps its history and can be made active again.</p></div>
      <VehiclesView vehicles={vehicles} />
    </div>
  );
}
