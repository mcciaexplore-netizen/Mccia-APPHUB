const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");

/** "2026-10-05" or an ISO instant -> "05-Oct-2026". */
export function fmtDate(v) {
  if (!v) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}
/** An ISO instant -> "05-Oct-2026 10:33:55". */
export function fmtDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : `${fmtDate(v)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 1234567.5 -> "₹12,34,567.50". */
export const inr = (n) => (n === null || n === undefined || n === "" ? "" : `${n < 0 ? "-" : ""}₹${INR.format(Math.abs(n))}`);

export const STATUS_STYLE = {
  Pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
  Approved: "bg-green-100 text-green-800 border-green-300",
  Rejected: "bg-red-100 text-red-800 border-red-300",
  "More Info Required": "bg-blue-100 text-blue-800 border-blue-300",
};
