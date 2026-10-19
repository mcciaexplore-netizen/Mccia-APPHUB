import { ArrowUpRight, LayoutGrid } from "lucide-react";

export type CardApp = { id: string; name: string; description: string | null; icon: string; status?: "active" | "testing" | "unavailable" };

/** One of six colour palettes (see .tile-0 to .tile-5 in globals.css), picked from the application's id so it always keeps its own. */
const palette = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
};

/** "MCCIA Car Booking App" -> "MCB": the first letter of up to three words. */
const initials = (name: string) => name.split(/[\s\-_/]+/).filter(Boolean).slice(0, 3).map((w) => w[0]!.toUpperCase()).join("") || "?";

const STATUS = { active: "", testing: "Under testing", unavailable: "Unavailable" } as const;

/**
 * A compact card: a coloured badge with the application's initials, its name, one line about it, and a footer saying what it is and how to
 * open it. Opens through the tracking route in a new tab, or a page of the hub in the same tab. An unavailable application is shown faded
 * and cannot be opened.
 */
export function AppCard({ app, deptName, index = 0, canOpenUnavailable = false, href, cta, kind = "Application" }: {
  app: CardApp; deptName?: string; index?: number; canOpenUnavailable?: boolean;
  /** A page inside the hub to open directly, in the same tab (instead of an application, through /go). */ href?: string;
  /** The words on the right of the footer; defaults to "Open". */ cta?: string;
  /** The words on the left of the footer. */ kind?: string;
}) {
  const status = app.status ?? "active";
  const blocked = status === "unavailable" && !canOpenUnavailable;
  const cls = `tile-${palette(app.id)} group flex min-h-44 animate-rise flex-col rounded-[10px] border border-gray-200 bg-white p-6 transition-all duration-200 ${blocked ? "opacity-55" : "hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-[0_6px_20px_rgba(15,23,42,0.08)]"}`;
  const note = deptName ?? (STATUS[status] || app.description);
  const inner = (
    <>
      <span aria-hidden className="grid h-12 w-12 place-items-center rounded-[10px] bg-[color:var(--tile-ink)] text-sm font-bold tracking-wide text-white">{initials(app.name)}</span>
      <span className="mt-4 block break-words text-lg leading-snug text-ink">{app.name}</span>
      {note && <span className="mt-1 line-clamp-1 text-sm text-subtle">{note}</span>}
      <span className="mt-auto flex items-center justify-between gap-2 pt-5 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5"><LayoutGrid size={15} aria-hidden className="text-primary" />{kind}</span>
        <span className={`inline-flex items-center gap-1 ${blocked ? "" : "text-ink group-hover:text-primary"}`}>
          {blocked ? "Cannot be opened right now" : <>{cta ?? "Open"}<ArrowUpRight size={15} aria-hidden /></>}
        </span>
      </span>
    </>
  );
  const style = { animationDelay: `${index * 50}ms` };
  if (blocked) return <div className={cls} style={style} title={app.description ?? app.name} aria-disabled="true">{inner}</div>;
  if (href) return <a href={href} title={app.description ?? app.name} style={style} className={cls}>{inner}</a>;
  return <a href={`/go/${app.id}`} target="_blank" rel="noopener noreferrer" title={app.description ?? app.name} style={style} className={cls}>{inner}</a>;
}
