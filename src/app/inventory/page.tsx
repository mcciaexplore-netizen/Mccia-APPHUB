import Link from "next/link";
import { AlertTriangle, ClipboardCheck, ClipboardList, History, Package, Truck, Users, Wrench, type LucideIcon } from "lucide-react";
import { ROLE_LABEL, SEES_ALL_BRANCHES, SEES_ITEMS, type InventoryRole } from "@/lib/inventory/inventory.manifest";
import { NO_BRANCH_MESSAGE } from "@/lib/inventory/branches";
import { dashboardStats, lowStockItems, recentMovements } from "@/lib/inventory/catalog";
import { formatCount, formatRupees } from "@/lib/inventory/format";
import { requirePage } from "@/lib/inventory/guard";
import { Suspense } from "react";
import { StatSkeleton, TableSkeleton } from "@/components/approvals/Skeletons";
import { canManagePeople, hasAnyRole, hasRole, listBranches } from "@/lib/inventory/host-adapter";
import { idSchema } from "@/lib/inventory/validation";
import { formatIST } from "@/lib/format";

/**
 * The Inventory dashboard: a card for each thing this person can do (by their role), and the real figures from the active items. Inventory
 * admins and Staff see every branch together, with a branch filter, plus the items running low and the latest stock movements; a user sees
 * their own branch's figures (or, with no branch, why they cannot request).
 */

const KIND_LABEL: Record<string, string> = { inward: "Inward", issue: "Issue", return: "Return", adjust: "Adjust", recount: "Recount", transfer: "Transfer" };

type Card = { href: string; icon: LucideIcon; title: string; text: string; roles?: readonly InventoryRole[]; people?: boolean };
const ADMIN = ["inventory_admin"] as const;

/** Users: request and maintenance. Staff: those and the item list. Inventory admins: everything. */
const CARDS: Card[] = [
  { href: "/inventory/items", icon: Package, title: "Browse items", text: "See what the store keeps and how much is in stock.", roles: SEES_ITEMS },
  { href: "/inventory/requests", icon: ClipboardList, title: "Request an item", text: "Ask the store for stationery, equipment or anything else it keeps, and follow your requests." },
  { href: "/inventory/maintenance", icon: Wrench, title: "Report a maintenance problem", text: "Tell the admin team about something broken, with a photo, and see when it is fixed." },
  { href: "/inventory/requests?status=pending", icon: ClipboardCheck, title: "Approve requests", text: "Approve or reject what people have asked the store for, and issue it.", roles: ADMIN },
  { href: "/inventory/vendors", icon: Truck, title: "Manage vendors", text: "Keep the suppliers you buy from, with their contact, GST and PAN details.", roles: ADMIN },
  // Who is Admin and Staff here is set on the Inventory application in Administrator → Applications: shown only to those who can open it.
  { href: "/administrator/inventory", icon: Users, title: "Manage users", text: "Choose who is Inventory Staff or Admin, on the Inventory application in Administrator → Applications.", roles: ADMIN, people: true },
];

/** One thing to do: a white card with the icon at the top left, a bold title and a line about it. Lifts a little on hover. */
function ActionCard({ href, icon: Icon, title, text }: Card) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-[var(--c-border)] bg-[var(--c-white)] p-6 shadow-[var(--shadow-card)] transition duration-200 hover:-translate-y-0.5 hover:border-[var(--c-primary)] hover:shadow-[var(--shadow-card-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-primary)] focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--c-primary)]/10 text-primary"><Icon size={22} aria-hidden /></span>
      <h2 className="mt-4 text-base font-bold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </Link>
  );
}

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

export default async function InventoryDashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const admin = hasRole(user, "inventory_admin");
  const allBranches = hasAnyRole(user, SEES_ALL_BRANCHES);
  const role: InventoryRole = admin ? "inventory_admin" : hasRole(user, "inventory_staff") ? "inventory_staff" : "requester";
  const people = admin && (await canManagePeople());
  const cards = CARDS.filter((c) => (!c.roles || hasAnyRole(user, c.roles)) && (!c.people || people));

  const heading = (
    <div>
      <h1 className="text-2xl">Inventory</h1>
      <p className="text-sm text-muted">Signed in as {user.name} · {ROLE_LABEL[role]}</p>
      <p className={`text-sm ${user.branchName ? "text-muted" : "font-semibold text-[#b45309]"}`}>{user.branchName ? `Branch: ${user.branchName}` : "No branch assigned"}</p>
    </div>
  );
  const actions = (
    <nav aria-label="What you can do" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => <ActionCard key={c.href} {...c} />)}
    </nav>
  );

  // A user: their own branch's figures only (no value or requests of others), or why they cannot request.
  if (!allBranches) {
    const mine = user.branchId ? await dashboardStats(user.branchId) : null;
    return (
      <div className="page-enter space-y-6">
        {heading}
        {!user.branchId && <p role="status" className="rounded-md border border-[#fcd34d] bg-[#fff8e1] px-4 py-3 text-sm font-semibold text-[#b45309]">{NO_BRANCH_MESSAGE}</p>}
        {actions}
        {mine && (
          <section aria-label={`At ${user.branchName}`} className="grid gap-4 sm:grid-cols-3">
            <Stat label={`Items at ${user.branchName}`} value={formatCount(mine.items)} />
            <Stat label="Units in stock" value={formatCount(mine.units)} />
            <Stat label="Low on stock" value={formatCount(mine.lowStock)} warn={mine.lowStock > 0} />
          </section>
        )}
      </div>
    );
  }

  // Inventory admins and Staff: every branch together, or the one chosen. The heading and the cards show at once; the figures stream in.
  const raw = (await searchParams).branch;
  const wanted = idSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  return (
    <div className="page-enter space-y-6">
      {heading}
      {actions}
      <Suspense fallback={<div role="status" aria-label="Loading figures" className="space-y-6"><StatSkeleton /><TableSkeleton rows={4} /></div>}>
        <BranchFigures branchId={wanted.success ? wanted.data : undefined} />
      </Suspense>
    </div>
  );
}

/** The figures, the items running low and the latest movements, for every branch or one. The branch list loads alongside them. */
async function BranchFigures({ branchId }: { branchId?: string }) {
  const [branchList, s, low, moves] = await Promise.all([listBranches(), dashboardStats(branchId), lowStockItems(8, branchId), recentMovements(8, branchId)]);
  const branch = branchList.find((b) => b.id === branchId);
  // An address naming a branch that does not exist shows every branch, as before.
  if (branchId && !branch) return <BranchFigures />;
  const withBranch = (href: string) => (branch ? `${href}${href.includes("?") ? "&" : "?"}branch=${branch.id}` : href);
  return (
    <>
      <form method="get" action="/inventory" className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="label-xs mb-1.5 block">Branch</span>
          <select name="branch" className="input !w-auto" defaultValue={branch?.id ?? ""}>
            <option value="">All branches</option>
            {branchList.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? "" : " (inactive)"}</option>)}
          </select></label>
        <button className="btn btn-primary btn-sm">Show</button>
        {branch && <Link href="/inventory" className="btn btn-ghost btn-sm">All branches</Link>}
      </form>

      <section aria-label={branch ? `Summary for ${branch.name}` : "Summary for all branches"} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Stat label="Items" value={formatCount(s.items)} href={withBranch("/inventory/items")} />
        <Stat label="Units in stock" value={formatCount(s.units)} />
        <Stat label="Stock value" value={formatRupees(s.valuePaise)} />
        <Stat label="Low on stock" value={formatCount(s.lowStock)} warn={s.lowStock > 0} href={withBranch("/inventory/items?low=1")} />
        <Stat label="Requests waiting" value={formatCount(s.pendingRequests)} warn={s.pendingRequests > 0} href={withBranch("/inventory/requests?status=pending")} />
        <Stat label="Open maintenance tickets" value={formatCount(s.openTickets)} href="/inventory/maintenance?status=open" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Low on stock">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl"><AlertTriangle size={18} className="text-brand-red" /> Low on stock</h2>
            {s.lowStock > low.length && <Link href={withBranch("/inventory/items?low=1")} className="text-sm text-primary hover:underline">All {s.lowStock}</Link>}
          </div>
          {low.length === 0 ? <p className="text-sm text-muted">Nothing is below its minimum stock.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Item</th><th className="text-right">In stock</th><th className="text-right">Minimum</th></tr></thead>
              <tbody>{low.map((i) => (
                <tr key={`${i.id}:${i.branchId}`}><td>{i.name}{!branch && <span className="block text-xs text-muted">{i.branchName}</span>}</td><td className="text-right font-semibold text-brand-red">{formatCount(i.quantity)} {i.unit}</td><td className="text-right text-muted">{formatCount(i.minQuantity)}</td></tr>
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
                  <span className="block truncate text-xs text-muted">{!branch && `${m.branchName} · `}{m.issuedToName ?? m.eventName ?? m.reason ?? ""}{m.actorName ? ` · by ${m.actorName}` : ""}</span>
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
    </>
  );
}
