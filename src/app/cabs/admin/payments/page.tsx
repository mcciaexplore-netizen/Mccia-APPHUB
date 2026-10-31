import Link from "next/link";
import { Download } from "lucide-react";
import { FuelView } from "@/components/cabs/FuelView";
import { PaymentsView } from "@/components/cabs/PaymentsView";
import { fuelThisMonth, listFuel } from "@/lib/cabs/fuel";
import { requireAdminPage } from "@/lib/cabs/guard";
import { formatRupees } from "@/lib/cabs/money";
import { listCostedRides, paymentSummary, rideBranches } from "@/lib/cabs/payments";
import { istNowLocal } from "@/lib/cabs/validation";
import { activeVehicles } from "@/lib/cabs/vehicles";

export const metadata = { title: "Payments · Cabs Admin · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** What rides cost: this month's figures, then completed rides with their cost ("Add Cost" where there is none); then Fuel Costs. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage();
  const sp = await searchParams;
  const f = { from: one(sp.from), to: one(sp.to), branch: one(sp.branch), missing: one(sp.missing) === "1" };
  const [rides, summary, branches, fuel, fuelMonth, vehicles] = await Promise.all([listCostedRides(f), paymentSummary(), rideBranches(), listFuel({}, 200), fuelThisMonth(), activeVehicles()]);
  const query = new URLSearchParams({ ...(f.from && { from: f.from }), ...(f.to && { to: f.to }), ...(f.branch && { branch: f.branch }) }).toString();
  const filtered = !!(f.from || f.to || f.branch || f.missing);
  const cards: [string, string][] = [["Total cost this month", formatRupees(summary.monthPaise)], ["Rides costed this month", String(summary.monthRides)], ["Average per ride", formatRupees(summary.avgPaise)]];
  return (
    <div className="page-enter space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl">Payments</h1><p className="text-sm text-muted">What completed rides cost. A cost can be changed until its invoice is sent. <Link href="/cabs/admin/payments/invoices" className="text-primary">Invoices</Link></p></div>
        <a href={`/api/cabs/payments/export?${query}`} className="btn btn-ghost btn-sm"><Download size={14} /> Export CSV</a>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map(([label, value]) => <div key={label} className="glass p-4" data-stat={label}><span className="label-xs block">{label}</span><span className="mt-1 block text-2xl font-bold text-ink">{value}</span></div>)}
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get" action="/cabs/admin/payments">
        <label className="block"><span className="label-xs mb-1.5 block">Completed from</span><input type="date" name="from" className="input !w-auto" defaultValue={f.from} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">To</span><input type="date" name="to" className="input !w-auto" defaultValue={f.to} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">Branch</span>
          <select name="branch" className="input !w-auto" defaultValue={f.branch}><option value="">All</option>{branches.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="missing" value="1" defaultChecked={f.missing} /> Only rides without a cost</label>
        <button className="btn btn-primary btn-sm">Show</button>
        {filtered && <Link href="/cabs/admin/payments" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      <PaymentsView rides={rides.map((r) => ({ ...r, completedAt: r.completedAt ? r.completedAt.toISOString() : null }))} />
      <FuelView records={fuel.map((r) => ({ ...r, fuelledAt: r.fuelledAt.toISOString() }))} vehicles={vehicles} month={fuelMonth} nowLocal={istNowLocal()} adminName={admin.name} />
    </div>
  );
}
