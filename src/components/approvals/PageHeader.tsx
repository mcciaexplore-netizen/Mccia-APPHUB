/**
 * Title block at the top of every Approval System page, in the hub's style: a blue title, a quiet intro and a line under it. Without a
 * title only the intro is shown, for a page whose name is already the main heading above it (the Budget forms).
 */
export function PageHeader({ title, intro, actions }: { title?: string; intro?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
      <div className="min-w-0">
        {title && <h2 className="text-xl text-ink sm:text-2xl">{title}</h2>}
        {intro && <p className={`${title ? "mt-1 " : ""}max-w-2xl text-sm text-subtle`}>{intro}</p>}
      </div>
      {actions}
    </div>
  );
}
