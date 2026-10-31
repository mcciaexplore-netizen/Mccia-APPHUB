import { DriversView } from "@/components/cabs/DriversView";
import { listDrivers } from "@/lib/cabs/drivers";
import { requireAdminPage } from "@/lib/cabs/guard";
import { listHubUsers } from "@/lib/cabs/host-adapter";
import { serverNow } from "@/lib/cabs/validation";

export const metadata = { title: "Drivers · Cabs Admin · MCCIA App Hub" };

/** The drivers: a name and a phone each (an email optional). Drivers sign in to Cabs Driver with their phone and a login OTP made here. */
export default async function DriversPage() {
  await requireAdminPage();
  const [drivers, people] = await Promise.all([listDrivers(), listHubUsers()]);
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Drivers</h1><p className="text-sm text-muted">Add drivers with their name and phone, mark who is available, and give each a login OTP for the driver app. Only available drivers can be given rides; the car is chosen for each ride.</p></div>
      <DriversView drivers={drivers.map((d) => ({ ...d, loginRequestedAt: d.loginRequestedAt?.toISOString() ?? null }))} people={people} now={serverNow()} />
    </div>
  );
}
