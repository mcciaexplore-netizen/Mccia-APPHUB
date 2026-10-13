/** Title block used at the top of every module screen. */
export function PageHeader({ title, intro, actions }: { title: string; intro?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl">{title}</h1>
        {intro && <p className="mt-1.5 max-w-2xl text-sm text-muted">{intro}</p>}
      </div>
      {actions}
    </div>
  );
}
