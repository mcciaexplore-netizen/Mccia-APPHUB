import { Icon } from "@/components/Icon";

export type CardApp = { id: string; name: string; description: string | null; icon: string };

/** One of six colour palettes (see .tile-0 to .tile-5 in globals.css), picked from the application's id so it always keeps its own. */
const palette = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
};

/**
 * A roomy white card: the department in small teal capitals, the application's name in bold, and its icon in a white round badge on a
 * coloured corner. Opens through the tracking route in a new tab.
 */
export function AppCard({ app, deptName, index = 0 }: { app: CardApp; deptName?: string; index?: number }) {
  return (
    <a
      href={`/go/${app.id}`}
      target="_blank"
      rel="noopener noreferrer"
      title={app.description ?? app.name}
      style={{ animationDelay: `${index * 60}ms` }}
      className={`tile-${palette(app.id)} group relative flex min-h-56 animate-rise flex-col overflow-hidden rounded-lg bg-white p-6 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover`}
    >
      {deptName && <span className="text-xs font-semibold uppercase tracking-wide text-primary">{deptName}</span>}
      <span className="mt-3 block break-words text-xl font-bold leading-snug tracking-tight text-ink">{app.name}</span>
      {app.description && <span className="mt-2 line-clamp-3 max-w-[52%] text-sm text-subtle">{app.description}</span>}
      <span aria-hidden className="tile-blob absolute bottom-0 right-0 h-32 w-28 rounded-tl-[3.5rem]" />
      <span
        aria-hidden
        className="absolute bottom-9 right-14 grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-white text-[color:var(--tile-ink)] shadow-card transition-transform duration-300 group-hover:scale-105"
      >
        <Icon name={app.icon} size={30} />
      </span>
    </a>
  );
}
