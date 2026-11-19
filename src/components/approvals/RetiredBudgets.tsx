import { listRetiredBudgets } from "@/lib/approvals/budget-delete";
import { formatDateTime, formatINR } from "@/lib/approvals/format";

/**
 * Deleted budgets, under All Budgets, for the Support Admin and the Super Admin: each retired Budget ID (never given again), its event and
 * amount, when it was deleted and by whom. Nothing shows until a budget has been deleted.
 */
export async function RetiredBudgets() {
  const list = await listRetiredBudgets();
  if (list.length === 0) return null;
  return (
    <section className="mt-10" aria-labelledby="retired-budgets" data-testid="retired-budgets">
      <h2 id="retired-budgets" className="text-lg text-ink">Deleted budgets (retired IDs)</h2>
      <p className="mt-1 text-sm text-muted">These Budget IDs belonged to budgets that were deleted. They are retired and are never given to another budget.</p>
      <div className="table-wrap mt-3">
        <table className="apr-table">
          <thead><tr><th>Retired Budget ID</th><th>Event</th><th>Amount</th><th>Versions</th><th>Deleted on</th><th>Deleted by</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={`${r.budgetId}-${r.deletedAt}`}>
                <td className="whitespace-nowrap font-bold line-through decoration-1">{r.budgetId}</td>
                <td>{r.eventName}</td>
                <td className="whitespace-nowrap">{r.amountPaise == null ? "—" : formatINR(r.amountPaise, { symbol: true })}</td>
                <td>{r.versions}</td>
                <td className="whitespace-nowrap">{formatDateTime(new Date(r.deletedAt))}</td>
                <td>{r.deletedByName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
