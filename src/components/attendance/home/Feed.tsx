"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { sendWishAction } from "@/lib/attendance/actions/staff";
import { FEED_EMOJI, WISH_TEMPLATES, fillTemplate, type FeedEvent } from "@/lib/attendance/feeds";
import type { FeedItem } from "@/lib/attendance/overview";
import { formatDayShort, formatMoment } from "@/lib/attendance/time";
import { Avatar, Card, Empty } from "../ui";
import { useAct } from "../use-act";

const WHAT: Record<FeedEvent["type"], (e: FeedEvent) => string> = {
  birthday: () => "Birthday today",
  anniversary: (e) => `${e.years} year${e.years === 1 ? "" : "s"} at MCCIA`,
  joiner: (e) => `Joined ${formatDayShort(e.date)}`,
};

/** Today's birthdays, anniversaries and joiners with "Send wishes", what is coming in the next 30 days, HR's announcements and wishes received. */
export function Feed({
  today,
  upcoming,
  announcements,
  wishesForMe,
}: {
  today: FeedItem[];
  upcoming: FeedEvent[];
  announcements: { id: string; title: string; content: string; createdAt: Date; by: string }[];
  wishesForMe: { from: string; message: string; type: string }[];
}) {
  const [wishing, setWishing] = useState<FeedItem | null>(null);
  return (
    <div className="flex flex-col gap-5">
      {wishesForMe.length > 0 && (
        <Card title="Wishes for you 💌">
          <ul className="flex flex-col gap-2">
            {wishesForMe.map((w, i) => (
              <li key={i} className="rounded-lg bg-[var(--att-green-tint)] px-3 py-2 text-sm">
                <span className="font-semibold">{w.from}:</span> {w.message}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Today">
        {today.length === 0 ? (
          <p className="text-sm att-muted">No birthdays, anniversaries or new joiners today.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {today.map((e) => (
              <li key={`${e.type}-${e.userId}`} className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden>
                  {FEED_EMOJI[e.type]}
                </span>
                <Avatar name={e.name} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{e.name}</p>
                  <p className="text-xs att-muted">{WHAT[e.type](e)}</p>
                </div>
                {e.self ? (
                  <span className="text-xs font-semibold att-muted">That&apos;s you! 🎈</span>
                ) : e.wished ? (
                  <span className="text-xs font-semibold text-[var(--att-green-dark)]">Wishes sent ✓</span>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWishing(e)}>
                    Send wishes
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Coming up (next 30 days)">
        {upcoming.length === 0 ? (
          <p className="text-sm att-muted">Nothing in the next 30 days.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {upcoming.slice(0, 12).map((e) => (
              <li key={`${e.type}-${e.userId}-${e.date}`} className="flex items-center gap-2">
                <span aria-hidden>{FEED_EMOJI[e.type]}</span>
                <span className="flex-1 truncate">
                  <span className="font-semibold">{e.name}</span> <span className="att-muted">· {e.type === "birthday" ? "birthday" : `${e.years} yr anniversary`}</span>
                </span>
                <span className="text-xs att-muted">{formatDayShort(e.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Announcements">
        {announcements.length === 0 ? (
          <Empty title="No announcements" />
        ) : (
          <ul className="flex flex-col gap-4">
            {announcements.map((a) => (
              <li key={a.id}>
                <p className="text-sm font-bold text-ink">{a.title}</p>
                {a.content && <p className="mt-0.5 whitespace-pre-line text-sm text-ink/80">{a.content}</p>}
                <p className="mt-1 text-xs att-muted">
                  {a.by} · {formatMoment(a.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {wishing && <WishDialog event={wishing} onClose={() => setWishing(null)} />}
    </div>
  );
}

function WishDialog({ event, onClose }: { event: FeedItem; onClose: () => void }) {
  const { act, pending } = useAct();
  const templates = WISH_TEMPLATES[event.type].map((t) => fillTemplate(t, event));
  const [message, setMessage] = useState(templates[0]);
  return (
    <Modal title={`${FEED_EMOJI[event.type]} Wish ${event.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-semibold att-muted">Pick a message or write your own</legend>
          {templates.map((t) => (
            <button key={t} type="button" onClick={() => setMessage(t)} className={`rounded-lg border px-3 py-2 text-left text-sm ${message === t ? "border-[var(--att-blue)] bg-[var(--att-blue-tint)]" : "border-[var(--att-line)]"}`}>
              {t}
            </button>
          ))}
        </fieldset>
        <textarea className="input" rows={3} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Your message" />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={pending || message.trim().length < 2}
            onClick={async () => {
              const r = await act(() => sendWishAction({ toUserId: event.userId, type: event.type, date: event.date, message }));
              if (r.ok) onClose();
            }}
          >
            Send wishes
          </button>
        </div>
      </div>
    </Modal>
  );
}
