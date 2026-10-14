/** A plain GET form: a date range (and optionally more fields) that reloads the report with ?from=&to=. Needs no JavaScript. */
export function RangeForm({ from, to, children }: { from: string; to: string; children?: React.ReactNode }) {
  return (
    <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
      <label className="block"><span className="label-xs block">From</span><input className="input" type="date" name="from" defaultValue={from} /></label>
      <label className="block"><span className="label-xs block">To</span><input className="input" type="date" name="to" defaultValue={to} /></label>
      {children}
      <button className="btn btn-primary btn-sm">Apply</button>
      <a className="btn btn-ghost btn-sm" href="?">Clear</a>
    </form>
  );
}

const day = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** ?from= and ?to= from the address, or "" when missing or not a date. */
export const readRange = (sp: Record<string, string | string[] | undefined>) => ({
  from: day.test(one(sp.from)) ? one(sp.from) : "",
  to: day.test(one(sp.to)) ? one(sp.to) : "",
});
