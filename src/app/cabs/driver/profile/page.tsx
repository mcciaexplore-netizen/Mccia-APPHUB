import Link from "next/link";
import { ChevronLeft, LogOut } from "lucide-react";
import { logout } from "@/actions/auth";
import { Avatar } from "@/components/cabs/CabsShell";
import { driverProfile } from "@/lib/cabs/drivers";
import { requireDriverPage } from "@/lib/cabs/guard";

export const metadata = { title: "Profile · Cabs Driver · MCCIA App Hub" };

/** Profile: the driver's details, their vehicle and how many rides they have completed; and the ways out. */
export default async function DriverProfilePage() {
  const user = await requireDriverPage();
  const p = user.driverId ? await driverProfile(user.driverId) : null;
  return (
    <div className="page-enter space-y-4">
      <h1 className="text-2xl font-extrabold text-ink">Profile</h1>
      <section className="flex items-center gap-4 rounded-xl bg-white p-5 shadow-sm" data-profile>
        <Avatar name={p?.name ?? user.name} size={64} />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-ink">{p?.name ?? user.name}</p>
          <p className="truncate text-sm text-muted">{p?.phone ?? "Not a driver (admin view)"}</p>
          <p className="truncate text-sm text-muted">{p?.email ?? user.email}</p>
        </div>
      </section>
      {p && (
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-widest text-muted">Vehicle</p>
            <p className="mt-1 font-bold text-ink">{p.vehiclePlate ?? "None assigned"}</p>{p.vehicleModel && <p className="text-sm text-muted">{p.vehicleModel}</p>}</div>
          <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase tracking-widest text-muted">Rides completed</p>
            <p className="mt-1 text-3xl font-extrabold text-ink" data-completed>{p.completed}</p></div>
        </section>
      )}
      <section className="divide-y divide-black/5 overflow-hidden rounded-xl bg-white shadow-sm">
        <Link href="/" className="flex min-h-14 items-center gap-3 px-5 text-base font-semibold text-ink hover:bg-[#f0f2f5]"><ChevronLeft size={18} aria-hidden /> Back to the App Hub</Link>
        <form action={logout}><button className="flex min-h-14 w-full items-center gap-3 px-5 text-left text-base font-semibold text-brand-red hover:bg-[#f0f2f5]"><LogOut size={18} aria-hidden /> Sign out</button></form>
      </section>
    </div>
  );
}
