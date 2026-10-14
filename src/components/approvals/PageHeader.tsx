/** Title block used at the top of every module screen: a plain title with a thin divider below, like the Zoho pages. */
export function PageHeader({ title, intro, actions }: { title: string; intro?: string; actions?: React.ReactNode }) {
  return (
    <div className="apr-page-head flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1>{title}</h1>
        {intro && <p className="apr-page-intro">{intro}</p>}
      </div>
      {actions}
    </div>
  );
}
