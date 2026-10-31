import { listDrivers, type ViewedDriver } from "@/lib/cabs/drivers";
import { hasRole, type CabUser } from "@/lib/cabs/host-adapter";
import { DriverPicker } from "./DriverPicker";

/** The "Viewing as" picker at the top of a driver-app page, for Cabs admins only (a driver never sees it). */
export async function AdminDriverPicker({ user, view }: { user: CabUser; view: ViewedDriver }) {
  if (!hasRole(user, "cab_admin")) return null;
  const drivers = await listDrivers();
  return <DriverPicker drivers={drivers.map((d) => ({ id: d.id, name: d.name, isAvailable: d.isAvailable }))} selected={view.driverId ?? ""} />;
}
