import { Icon } from "@/components/Icon";

export type CardApp = { id: string; name: string; description: string | null; icon: string };

/** Round gradient icon with the name underneath; opens through the tracking route in a new tab. */
export function AppCard({ app, deptName, index = 0 }: { app: CardApp; deptName?: string; index?: number }) {
  return (
    <a
      href={`/go/${app.id}`}
      target="_blank"
      rel="noopener noreferrer"
      title={app.description ?? app.name}
      style={{ animationDelay: `${index * 80}ms` }}
      className="glass glass-hover group flex aspect-square animate-rise flex-col items-center justify-center gap-2 !rounded-md p-3 text-center"
    >
      <span className="grid h-14 w-14 place-items-center rounded-full bg-[image:var(--grad-icon)] text-white shadow-btn transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[5deg]">
        <Icon name={app.icon} size={24} />
      </span>
      <span className="text-sm font-medium leading-snug text-muted transition-colors group-hover:text-primary">{app.name}</span>
      {app.description && <span className="line-clamp-1 text-xs text-subtle">{app.description}</span>}
      {deptName && <span className="label-xs !text-[0.62rem]">{deptName}</span>}
    </a>
  );
}
