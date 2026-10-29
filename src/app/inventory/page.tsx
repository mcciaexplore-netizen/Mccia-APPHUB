import Link from "next/link";
import { AlertTriangle, ClipboardList, History, Package, Wrench } from "lucide-react";
import { STAFF_ROLES, ROLE_LABEL } from "@/lib/inventory/inventory.manifest";
import { dashboardStats, lowStockItems, recentMovements } from "@/lib/inventory/catalog";
import { formatCount, formatRupees } from "@/lib/inventory/format";
import { requirePage } from "@/lib/inventory/guard";
import { hasAnyRole } from "@/lib/inventory/host-adapter";
import { formatIST } from "@/lib/format";

/** The Inventory dashboard: real figures from the active items, the items running low and the latest stock movements. */

const KIND_LABEL: Record<string, string> = { inward: "Inward", issue: "Issue", return: "Return", adjust: "Adjust", recount: "Recount" };

function Stat({ label, value, warn, href }: { label: string; value: string | number; warn?: boolean; href?: string }) {
  // An amount is longer than a count, so it gets a smaller size to stay inside its tile.
  const long = String(value).length > 5;
  const body = (
    <>
      <p className={`big-number ${long ? "!text-2xl" : ""} ${warn ? "!text-brand-red" : ""}`}>{value}</p>
      <p className="label-xs mt-2">{label}</p>
    </>
  );
  const cls = "glass !rounded-md block min-w-0 p-5 text-center";
  return href ? <Link href={href} className={`${cls} glass-hover`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export default async function InventoryDashboard() {
  const user = await requirePage();
  const staff = hasAnyRole(user, STAFF_ROLES);
  const role = user.roles.includes("inventory_admin") ? "inventory_admin" : staff ? "inventory_staff" : "requester";

  const heading = (
    <div>
      <h1 className="text-2xl">Inventory</h1>
      <p className="text-sm text-muted">Signed in as {user.name} · {ROLE_LABEL[role]}</p>
    </div>
  );

  if (!staff) {
    return (
      <div className="page-enter space-y-6">
        {heading}
        <div className="grid gap-6 lg:grid-cols-3">
          <Link href="/inventory/items" className="glass glass-hover !rounded-md space-y-2 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-xl"><Package size={18} className="text-primary" /> Browse items</h2>
            <p className="text-sm text-muted">See what the store keeps and how much is in stock.</p>
          </Link>
          <Link href="/inventory/requests" className="glass glass-hover !rounded-md space-y-2 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-xl"><ClipboardList size={18} className="text-primary" /> Request an item</h2>
            <p className="text-sm text-muted">Ask the store for stationery, equipment or anything else it keeps, and follow your requests.</p>
          </Link>
          <section className="glass !rounded-md space-y-2 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-xl"><Wrench size={18} className="text-primary" /> Report a maintenance problem</h2>
            <p className="text-sm text-muted">Tell the admin team about something broken, with a photo, and see when it is fixed.</p>
            <span className="badge badge-neutral">Coming soon</span>
          </section>
        </div>
      </div>
    );
  }

  const [s, low, moves] = await Promise.all([dashboardStats(), lowStockItems(8), recentMovements(8)]);
  return (
    <div className="page-enter space-y-6">
      {heading}

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Stat label="Items" value={formatCount(s.items)} href="/inventory/items" />
        <Stat label="Units in stock" value={formatCount(s.units)} />
        <Stat label="Stock value" value={formatRupees(s.valuePaise)} />
        <Stat label="Low on stock" value={formatCount(s.lowStock)} warn={s.lowStock > 0} href="/inventory/items?low=1" />
        <Stat label="Requests waiting" value={formatCount(s.pendingRequests)} warn={s.pendingRequests > 0} href="/inventory/requests?status=pending" />
        <Stat label="Open maintenance tickets" value={formatCount(s.openTickets)} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Low on stock">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl"><AlertTriangle size={18} className="text-brand-red" /> Low on stock</h2>
            {s.lowStock > low.length && <Link href="/inventory/items?low=1" className="text-sm text-primary hover:underline">All {s.lowStock}</Link>}
          </div>
          {low.length === 0 ? <p className="text-sm text-muted">Nothing is below its minimum stock.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Item</th><th className="text-right">In stock</th><th className="text-right">Minimum</th></tr></thead>
              <tbody>{low.map((i) => (
                <tr key={i.id}><td>{i.name}</td><td className="text-right font-semibold text-brand-red">{formatCount(i.quantity)} {i.unit}</td><td className="text-right text-muted">{formatCount(i.minQuantity)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>

        <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Recent stock movements">
          <h2 className="flex items-center gap-2 text-xl"><History size={18} className="text-primary" /> Recent stock movements</h2>
          {moves.length === 0 ? <p className="text-sm text-muted">No stock has moved yet. Issues, returns, inward goods and recounts will appear here.</p> : (
            <ul className="divide-y divide-line text-sm">{moves.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="badge badge-neutral mr-2">{KIND_LABEL[m.kind] ?? m.kind}</span><b>{m.item}</b>
                  <span className="block truncate text-xs text-muted">{m.issuedToName ?? m.eventName ?? m.reason ?? ""}{m.actorName ? ` · by ${m.actorName}` : ""}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`block font-semibold ${m.delta < 0 ? "text-brand-red" : "text-[var(--c-green-text)]"}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                  <span className="block text-xs text-subtle">{formatIST(m.createdAt)}</span>
                </span>
              </li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
