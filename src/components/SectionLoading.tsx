/**
 * What a section shows the moment a page is opened, while its data loads: a title bar and a few rows of grey placeholders, inside the
 * section's own frame (its menu stays). Used by the loading.tsx files of the modules that have no skeleton of their own.
 */
export function SectionLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-6">
      <div className="skeleton h-9 w-56 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-24 !rounded-lg" />)}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-12 !rounded-lg" />)}
      </div>
    </div>
  );
}
