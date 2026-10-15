export default function Loading() {
  return (
    <div>
      <div className="skeleton mb-8 h-10 w-64" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-6">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-56 !rounded-lg" />)}
      </div>
    </div>
  );
}
