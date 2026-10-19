import { Icon } from "@/components/Icon";

export type CardApp = { id: string; name: string; description: string | null; icon: string; status?: "active" | "testing" | "unavailable" };

/** One of six colour palettes (see .tile-0 to .tile-5 in globals.css), picked from the application's id so it always keeps its own. */
const palette = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
};

const STATUS = {
  active: { label: "Active", dot: "bg-brand-green" },
  testing: { label: "Under testing", dot: "bg-[var(--tile-ink)]" },
  unavailable: { label: "Unavailable", dot: "bg-brand-red" },
} as const;

/**
 * A roomy white card: the department in small teal capitals, the application's name in bold, its availability, and its icon in a white
 * round badge on a coloured corner. Opens through the tracking route in a new tab. An unavailable application is shown but cannot be opened.
 */
export function AppCard({ app, deptName, index = 0, canOpenUnavailable = false, href, cta }: { app: CardApp; deptName?: string; index?: number; canOpenUnavailable?: boolean; /** A page inside the hub to open directly, in the same tab (instead of an application, through /go). */ href?: string; /** The line under the status; defaults to "Open application". */ cta?: string }) {
  const status = app.status ?? "active";
  const blocked = status === "unavailable" && !canOpenUnavailable;
  const cls = `tile-${palette(app.id)} group relative flex min-h-56 animate-rise flex-col overflow-hidden rounded-none border border-gray-200 bg-white p-6 transition-all duration-300 ${blocked ? "opacity-80" : "hover:-translate-y-1"}`;
  const inner = (
    <>
      {deptName && <span className="text-xs font-semibold uppercase tracking-wide text-primary">{deptName}</span>}
      <span className="mt-3 block break-words text-xl font-bold leading-snug tracking-tight text-ink">{app.name}</span>
      {app.description && <span className="mt-2 line-clamp-3 max-w-[52%] text-sm text-subtle">{app.description}</span>}
      <span className="mt-auto flex flex-col gap-1 pt-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted"><span aria-hidden className={`h-2 w-2 rounded-full ${STATUS[status].dot}`} />{STATUS[status].label}</span>
        <span className={`text-xs font-semibold ${blocked ? "text-subtle" : "text-primary"}`}>{blocked ? "Cannot be opened right now" : cta ?? "Open application"}</span>
      </span>
      <span aria-hidden className="absolute bottom-9 right-14 grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-white text-[color:var(--tile-ink)] shadow-card transition-transform duration-300 group-hover:scale-105">
        <Icon name={app.icon} size={30} />
      </span>
    </>
  );
  const style = { animationDelay: `${index * 60}ms` };
  if (blocked) return <div className={cls} style={style} title={app.description ?? app.name} aria-disabled="true">{inner}</div>;
  if (href) return <a href={href} title={app.description ?? app.name} style={style} className={cls}>{inner}</a>;
  return <a href={`/go/${app.id}`} target="_blank" rel="noopener noreferrer" title={app.description ?? app.name} style={style} className={cls}>{inner}</a>;
}
