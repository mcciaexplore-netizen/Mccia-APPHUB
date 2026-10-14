import { STATUS_STYLE } from "../../constants/status.js";

export default function StatusBadge({ status }) {
  return <span className={`inline-block whitespace-nowrap rounded border px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[status] ?? "bg-gray-100"}`}>{status}</span>;
}
