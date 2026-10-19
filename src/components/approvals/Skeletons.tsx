/** Grey placeholders shown while a page's data is on its way (the shimmer is the hub's .skeleton style). */

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-md border border-line p-5" aria-hidden>
      <div className="skeleton mb-4 h-5 w-1/2" />
      {Array.from({ length: lines }).map((_, i) => <div key={i} className="skeleton mb-2 h-3.5" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="skeleton h-9 w-full" />
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-11 w-full" />)}
    </div>
  );
}

export function StatSkeleton() {
  return <div className="skeleton h-24 w-full" aria-hidden />;
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <div className="grid gap-6 sm:grid-cols-2"><CardSkeleton /><CardSkeleton /></div>
      <TableSkeleton />
    </div>
  );
}
