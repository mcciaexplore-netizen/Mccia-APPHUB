/** Grey placeholders shown while a page's data is on its way (the shimmer is the hub's .skeleton style). */

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
