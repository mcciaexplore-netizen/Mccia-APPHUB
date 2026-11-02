import { trackingByToken } from "@/lib/design/public";
import { FINISHED_STATUSES } from "@/lib/design/rules";
import { StatusBadge, formatDateTime } from "@/components/design/ui";

export const metadata = { title: "Track your request · MCCIA", robots: { index: false } };

/** The tracking link from the confirmation email (no sign-in): where the request is, when each step happened, and when it is due. */
export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await trackingByToken(token);
  if (!t)
    return (
      <div className="ds-card px-6 py-12 text-center">
        <h1 className="text-xl font-bold text-ink">This tracking link is not valid</h1>
        <p className="mt-2 text-sm ds-muted">Check that you opened the whole link from the email.</p>
      </div>
    );
  const finished = FINISHED_STATUSES.includes(t.status);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="ds-label">Track your request</p>
        <h1 className="mt-1 text-[1.6rem] font-bold text-ink">
          <span className="text-[var(--ds-navy)]">{t.number}</span> — {t.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <StatusBadge status={t.status} />
          {t.deliveredAt ? (
            <span className="ds-muted">Delivered {formatDateTime(t.deliveredAt)} IST</span>
          ) : t.dueAt && t.status !== "declined" && t.status !== "superseded" ? (
            <span>
              <span className="ds-muted">Estimated delivery </span>
              <span className="font-semibold text-ink">{formatDateTime(t.dueAt)} IST</span>
            </span>
          ) : null}
        </div>
        {t.newerVersion && <p className="mt-2 text-sm text-ink">You asked for changes: the design team is working on {t.newerVersion}.</p>}
        {t.status === "declined" && <p className="mt-2 text-sm text-[var(--ds-red)]">This request was declined by the design team.</p>}
      </div>

      <section className="ds-card p-6" aria-label="Progress">
        <ol className="relative flex flex-col gap-0">
          {t.steps.map((s, i) => {
            const done = i < t.currentStep || (finished && i === t.currentStep);
            const current = i === t.currentStep && !finished;
            return (
              <li key={s.label} className="relative flex gap-4 pb-6 last:pb-0">
                {i < t.steps.length - 1 && <span className={`absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5 ${done ? "bg-[var(--ds-green)]" : "bg-[var(--ds-line)]"}`} aria-hidden />}
                <span
                  className={`relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[0.6rem] font-bold ${
                    done ? "border-[var(--ds-green)] bg-[var(--ds-green)] text-white" : current ? "border-[var(--ds-navy)] bg-[var(--ds-navy)] text-white" : "border-[#cbd5e1] bg-white"
                  }`}
                  aria-hidden
                >
                  {done ? "✓" : current ? "●" : ""}
                </span>
                <span>
                  <span className={`block text-sm ${current ? "font-bold text-[var(--ds-navy)]" : done ? "font-semibold text-ink" : "ds-muted"}`}>
                    {s.label}
                    {current && <span className="sr-only"> (current step)</span>}
                  </span>
                  <span className="block text-xs ds-muted">{s.at ? `${formatDateTime(s.at)} IST` : done || current ? "" : "Not yet"}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="ds-card" aria-label="Recent activity">
        <h2 className="border-b border-[var(--ds-line)] px-5 py-3.5 text-[1.02rem] font-bold text-ink">Recent activity</h2>
        <ul className="divide-y divide-[var(--ds-line)]">
          {t.history.map((h, i) => (
            <li key={i} className="flex justify-between gap-4 px-5 py-2.5 text-sm">
              <span className="text-ink">{h.text}</span>
              <time className="shrink-0 text-xs ds-muted" dateTime={h.at}>
                {formatDateTime(h.at)}
              </time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
