"use client";

import { useState } from "react";
import { Megaphone, Trash2 } from "lucide-react";
import { deleteAnnouncementAction, postAnnouncementAction } from "@/lib/attendance/actions/admin";
import { formatMoment } from "@/lib/attendance/time";
import { Card, Field } from "../ui";
import { useAct } from "../use-act";

/** HR post announcements to everyone's Home feed (the latest five show there). */
export function Announcements({ items }: { items: { id: string; title: string; content: string; createdAt: Date }[] }) {
  const { act, pending } = useAct();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  return (
    <Card title="Announcements on everyone's Home" icon={Megaphone} iconTone="orange">
      <form
        className="grid gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() => postAnnouncementAction({ title, content }));
          if (r.ok) {
            setTitle("");
            setContent("");
          }
        }}
      >
        <Field label="Title">
          <input className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="Message (optional)">
          <textarea className="input" rows={2} maxLength={2000} value={content} onChange={(e) => setContent(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            Post
          </button>
        </div>
      </form>
      {items.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--att-line)] border-t border-[var(--att-line)]">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-2 py-2.5 text-sm">
              <div className="flex-1">
                <p className="font-semibold">{a.title}</p>
                <p className="text-xs att-muted">{formatMoment(a.createdAt)}</p>
              </div>
              <button type="button" aria-label="Remove announcement" className="att-muted hover:text-[var(--att-red)]" disabled={pending} onClick={() => act(() => deleteAnnouncementAction(a.id))}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
