/** The title at the top of every page, with a thin line under it, an optional intro and any buttons on the right. */
export default function PageTitle({ title, intro, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 pb-3">
      <div>
        <h1 className="text-xl">{title}</h1>
        {intro && <p className="mt-1 max-w-2xl text-sm text-gray-500">{intro}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
