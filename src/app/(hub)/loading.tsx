export default function Loading() {
  return (
    <div>
      <div className="skeleton mb-8 h-12 w-64" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-square" />)}
      </div>
    </div>
  );
}
