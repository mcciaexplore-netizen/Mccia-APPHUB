import { StatSkeleton, TableSkeleton } from "@/components/approvals/Skeletons";

/** Shown under the Administrator heading while a section's data loads. */
export default function Loading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)}</div>
      <TableSkeleton />
    </div>
  );
}
