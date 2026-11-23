/** A page's shape while its data loads: a heading and a few cards, shimmering (still with reduced motion). */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="att-skel h-8 w-56 max-w-full" />
        <div className="att-skel h-4 w-72 max-w-full" />
      </div>
      <div className="att-skel h-36 w-full rounded-2xl" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {Array.from({ length: cards }, (_, i) => (
            <div key={i} className="att-skel h-16 w-full" />
          ))}
        </div>
        <div className="hidden flex-col gap-4 xl:flex">
          <div className="att-skel h-28 w-full rounded-2xl" />
          <div className="att-skel h-28 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
