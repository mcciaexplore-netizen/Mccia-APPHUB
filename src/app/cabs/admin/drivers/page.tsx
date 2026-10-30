import { DriversView } from "@/components/cabs/DriversView";
import { listDrivers } from "@/lib/cabs/drivers";
import { requireAdminPage } from "@/lib/cabs/guard";
import { listHubUsers } from "@/lib/cabs/host-adapter";
import { activeVehicles } from "@/lib/cabs/vehicles";

export const metadata = { title: "Drivers · Cabs Admin · MCCIA App Hub" };

/** The drivers: a name, an email and a phone each. Signing in to the hub with a driver's email is what opens Cabs Driver. */
export default async function DriversPage() {
  await requireAdminPage();
  const [drivers, people, vehicles] = await Promise.all([listDrivers(), listHubUsers(), activeVehicles()]);
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Drivers</h1><p className="text-sm text-muted">Add drivers with their name, email and phone, give each a vehicle, and mark who is available. Only available drivers can be given rides.</p></div>
      <DriversView drivers={drivers} people={people} vehicles={vehicles} />
    </div>
  );
}
