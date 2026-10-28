import { ArrowRight, ArrowUpRight, Clock, Users } from "lucide-react";
import { Icon } from "@/components/Icon";

/** `ssoSlug` is set for an application with single sign-on: it opens through /launch/<ssoSlug> (which signs the person in) instead of /go/<id>. */
export type CardApp = { id: string; name: string; description: string | null; icon: string; status?: "active" | "testing" | "unavailable"; ssoSlug?: string | null };

/** One of six colour palettes (see .tile-0 to .tile-5 in globals.css), picked from the application's id so it always keeps its own. */
const palette = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
};

const STATUS = {
  active: { label: "Active", cls: "bg-green-tint text-brand-green-text" },
  testing: { label: "Under testing", cls: "bg-[#fff7e6] text-[#b7791f]" },
  unavailable: { label: "Unavailable", cls: "bg-alt text-subtle" },
} as const;

/**
 * A card for an application or a part of the hub: a strip and badge in the application's own colour with its icon, its name and what it is
 * for, its status, its category, when this person last opened it, and (for those who manage access) how many people have it. An external
 * application opens in a new tab (↗); a part of the hub opens in the same tab (→). An unavailable application is faded and cannot be opened.
 */
export function AppCard({ app, deptName, index = 0, canOpenUnavailable = false, href, cta, kind = "Application", lastOpened, people, waiting }: {
  app: CardApp; /** The application's category (Finance, Car Booking, ...). */ deptName?: string; index?: number; canOpenUnavailable?: boolean;
  /** A page inside the hub to open directly, in the same tab (instead of an application, through /go). */ href?: string;
  /** The words on the right of the footer; defaults to "Open". */ cta?: string;
  /** What it is, when there is no category. */ kind?: string;
  /** "2 days ago": when this person last opened it. */ lastOpened?: string;
  /** How many people have been given it (shown to those who manage access). */ people?: number;
  /** Requests waiting for this person (the Approval System card). */ waiting?: number;
}) {
  const status = app.status;
  const blocked = status === "unavailable" && !canOpenUnavailable;
  const external = !href;
  const cls = `tile-${palette(app.id)} group flex min-h-52 animate-rise flex-col overflow-hidden rounded-[14px] border border-gray-200 border-t-[3px] border-t-[color:var(--tile-ink)] bg-white p-5 transition-all duration-200 ${blocked ? "opacity-55" : "hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.10)]"}`;
  const inner = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-[color:var(--tile-ink)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
          <Icon name={app.icon} size={22} />
        </span>
        <span className="flex flex-wrap justify-end gap-1.5">
          {!!waiting && <span className="rounded-pill bg-brand-red px-2.5 py-0.5 text-xs font-bold text-white">{waiting} waiting for you</span>}
          {status && <span className={`rounded-pill px-2.5 py-0.5 text-xs font-semibold ${STATUS[status].cls}`}>{STATUS[status].label}</span>}
        </span>
      </span>
      <span className="mt-4 block break-words text-lg font-semibold leading-snug text-ink">{app.name}</span>
      {app.description && <span className="mt-1 line-clamp-2 text-sm text-subtle">{app.description}</span>}
      <span className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-pill border border-line bg-alt px-2.5 py-0.5 text-xs text-muted">{deptName ?? kind}</span>
        {people !== undefined && <span className="inline-flex items-center gap-1 rounded-pill border border-line bg-alt px-2.5 py-0.5 text-xs text-muted"><Users size={12} aria-hidden />{people} {people === 1 ? "person has" : "people have"} access</span>}
      </span>
      <span className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">{lastOpened ? <><Clock size={13} aria-hidden />You opened it {lastOpened}</> : external ? "Not opened yet" : ""}</span>
        <span className={`inline-flex items-center gap-1 text-sm font-semibold ${blocked ? "text-subtle" : "text-primary"}`}>
          {blocked ? "Cannot be opened right now" : <>{cta ?? "Open"}{external ? <ArrowUpRight size={15} aria-label="opens in a new tab" /> : <ArrowRight size={15} aria-hidden />}</>}
        </span>
      </span>
    </>
  );
  const style = { animationDelay: `${index * 50}ms` };
  if (blocked) return <div className={cls} style={style} title={app.description ?? app.name} aria-disabled="true">{inner}</div>;
  if (href) return <a href={href} title={app.description ?? app.name} style={style} className={cls}>{inner}</a>;
  return <a href={app.ssoSlug ? `/launch/${app.ssoSlug}` : `/go/${app.id}`} target="_self" rel="noopener noreferrer" title={app.description ?? app.name} style={style} className={cls}>{inner}</a>;
}
