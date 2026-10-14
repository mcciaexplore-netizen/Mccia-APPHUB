import { STATUS_STYLE } from "../lib.js";

export const StatusBadge = ({ status }) => (
  <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[status] ?? "bg-gray-100"}`}>{status}</span>
);

export const PageTitle = ({ title, intro, children }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 pb-3">
    <div>
      <h1 className="text-xl">{title}</h1>
      {intro && <p className="mt-1 max-w-2xl text-sm text-gray-500">{intro}</p>}
    </div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);
