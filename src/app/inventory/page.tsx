import { AlertTriangle, ClipboardList, Package, Wrench } from "lucide-react";
import { STAFF_ROLES, ROLE_LABEL } from "@/lib/inventory/inventory.manifest";
import { requirePage } from "@/lib/inventory/guard";
import { hasAnyRole } from "@/lib/inventory/host-adapter";

/**
 * The Inventory dashboard. SAMPLE DATA ONLY for now: nothing here reads the inventory_ tables yet, so the page works before
 * scripts/apply-0021-inventory-in-neon-console.sql has been run. Replace SAMPLE with real queries when the item and stock screens are built.
 */
const SAMPLE = {
  stats: { items: 148, lowStock: 6, pendingRequests: 9, openTickets: 3, stockValuePaise: 18_42_350_00 },
  lowStock: [
    { name: "A4 paper (ream)", unit: "Ream", quantity: 4, min: 20 },
    { name: "Whiteboard marker, blue", unit: "Nos", quantity: 3, min: 12 },
    { name: "Printer toner HP 88A", unit: "Nos", quantity: 1, min: 3 },
    { name: "Visitor badge holders", unit: "Nos", quantity: 15, min: 50 },
  ],
  requests: [
    { item: "Extension board (4 socket)", quantity: 2, by: "Event team", when: "Today, 10:42" },
    { item: "A4 paper (ream)", quantity: 5, by: "Accounts", when: "Today, 09:15" },
    { item: "Projector clicker", quantity: 1, by: "Training cell", when: "Yesterday" },
  ],
  movements: [
    { kind: "Issue", item: "Laptop stand", change: -1, to: "R. Kulkarni", when: "Today, 11:05" },
    { kind: "Inward", item: "A4 paper (ream)", change: 40, to: "PO-2026-27-0012", when: "Yesterday" },
    { kind: "Return", item: "Wireless mic", change: 2, to: "Auditorium event", when: "Yesterday" },
    { kind: "Recount", item: "Pens, black", change: -7, to: "Monthly count", when: "2 days ago" },
  ],
};

const rupees = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  // An amount is longer than a count, so it gets a smaller size to stay inside its tile.
  const long = String(value).length > 5;
  return (
    <div className="glass !rounded-md min-w-0 p-5 text-center">
      <p className={`big-number ${long ? "!text-2xl" : ""} ${warn ? "!text-brand-red" : ""}`}>{value}</p>
      <p className="label-xs mt-2">{label}</p>
    </div>
  );
}

export default async function InventoryDashboard() {
  const user = await requirePage();
  const staff = hasAnyRole(user, STAFF_ROLES);
  const s = SAMPLE.stats;
  const role = user.roles.includes("inventory_admin") ? "inventory_admin" : staff ? "inventory_staff" : "requester";
  return (
    <div className="page-enter space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Inventory</h1>
          <p className="text-sm text-muted">Signed in as {user.name} · {ROLE_LABEL[role]}</p>
        </div>
        <span className="badge badge-purple" title="These figures are examples. Real stock appears once the item screens are built.">Sample data</span>
      </div>

      {staff ? (
        <>
          <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Items" value={s.items} />
            <Stat label="Low on stock" value={s.lowStock} warn />
            <Stat label="Requests waiting" value={s.pendingRequests} warn />
            <Stat label="Open maintenance tickets" value={s.openTickets} />
            <Stat label="Stock value" value={rupees(s.stockValuePaise)} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Low on stock">
              <h2 className="flex items-center gap-2 text-xl"><AlertTriangle size={18} className="text-brand-red" /> Low on stock</h2>
              <div className="table-wrap"><table>
                <thead><tr><th>Item</th><th className="text-right">In stock</th><th className="text-right">Minimum</th></tr></thead>
                <tbody>{SAMPLE.lowStock.map((i) => (
                  <tr key={i.name}><td>{i.name}</td><td className="text-right font-semibold text-brand-red">{i.quantity} {i.unit}</td><td className="text-right text-muted">{i.min}</td></tr>
                ))}</tbody>
              </table></div>
            </section>

            <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Requests waiting">
              <h2 className="flex items-center gap-2 text-xl"><ClipboardList size={18} className="text-primary" /> Requests waiting</h2>
              <ul className="divide-y divide-line text-sm">{SAMPLE.requests.map((r) => (
                <li key={r.item + r.when} className="flex items-center justify-between gap-3 py-2.5">
                  <span><b>{r.item}</b> × {r.quantity}<span className="block text-xs text-muted">{r.by}</span></span>
                  <span className="shrink-0 text-xs text-subtle">{r.when}</span>
                </li>
              ))}</ul>
            </section>
          </div>

          <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Recent stock movements">
            <h2 className="flex items-center gap-2 text-xl"><Package size={18} className="text-primary" /> Recent stock movements</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>What</th><th>Item</th><th className="text-right">Change</th><th>To / from</th><th>When</th></tr></thead>
              <tbody>{SAMPLE.movements.map((m) => (
                <tr key={m.item + m.when}>
                  <td><span className="badge badge-neutral">{m.kind}</span></td><td>{m.item}</td>
                  <td className={`text-right font-semibold ${m.change < 0 ? "text-brand-red" : "text-[var(--c-green-text)]"}`}>{m.change > 0 ? `+${m.change}` : m.change}</td>
                  <td className="text-muted">{m.to}</td><td className="text-xs text-subtle">{m.when}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="glass !rounded-md space-y-2 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-xl"><ClipboardList size={18} className="text-primary" /> Request an item</h2>
            <p className="text-sm text-muted">Ask the store for stationery, equipment or anything else it keeps. You will be able to follow your requests here.</p>
            <span className="badge badge-neutral">Coming soon</span>
          </section>
          <section className="glass !rounded-md space-y-2 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 text-xl"><Wrench size={18} className="text-primary" /> Report a maintenance problem</h2>
            <p className="text-sm text-muted">Tell the admin team about something broken, with a photo, and see when it is fixed.</p>
            <span className="badge badge-neutral">Coming soon</span>
          </section>
        </div>
      )}
    </div>
  );
}
