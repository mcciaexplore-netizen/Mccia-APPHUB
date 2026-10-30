import Link from "next/link";
import { ChevronLeft, LogOut } from "lucide-react";
import { logout } from "@/actions/auth";
import { Avatar } from "@/components/cabs/CabsShell";
import { ridesThisMonth } from "@/lib/cabs/bookings";
import { requireCabsPage } from "@/lib/cabs/guard";

export const metadata = { title: "Account · MCCIA Cabs · MCCIA App Hub" };

/** The person's account: who they are, their branch, how many rides they booked this month, and the ways out. */
export default async function AccountPage() {
  const user = await requireCabsPage();
  const month = await ridesThisMonth(user.id);
  return (
    <div className="page-enter max-w-xl space-y-4">
      <h1 className="text-3xl font-extrabold text-ink">Account</h1>
      <section className="flex items-center gap-4 rounded-xl bg-white p-5 shadow-sm" data-account>
        <Avatar name={user.name} size={64} />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-ink">{user.name}</p>
          <p className="truncate text-sm text-muted">{user.email}</p>
          <p className="text-sm text-muted">{user.branchName ?? "No branch set"}</p>
        </div>
      </section>
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-widest text-muted">Rides this month</p>
        <p className="mt-1 text-3xl font-extrabold text-ink" data-rides-this-month>{month}</p>
      </section>
      <section className="divide-y divide-black/5 overflow-hidden rounded-xl bg-white shadow-sm">
        <Link href="/" className="flex min-h-14 items-center gap-3 px-5 text-base font-semibold text-ink hover:bg-[#f5f5f5]"><ChevronLeft size={18} aria-hidden /> Back to the App Hub</Link>
        <form action={logout}><button className="flex min-h-14 w-full items-center gap-3 px-5 text-left text-base font-semibold text-brand-red hover:bg-[#f5f5f5]"><LogOut size={18} aria-hidden /> Sign out</button></form>
      </section>
    </div>
  );
}
