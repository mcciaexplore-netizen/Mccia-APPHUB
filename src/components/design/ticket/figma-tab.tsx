"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { TicketDetail } from "@/lib/design/detail";
import { updateTicketAction } from "@/lib/design/actions/tickets";
import { figmaEmbedUrl } from "@/lib/design/rules";
import { Card } from "../ui";
import { useAct } from "./use-act";

/** Tab 4: the ticket's Figma file, shown in the page when the link is a Figma file, design, prototype or board. */
export function FigmaTab({ d, editable }: { d: TicketDetail; editable: boolean }) {
  const { act, pending } = useAct();
  const [url, setUrl] = useState(d.figmaUrl ?? "");
  const embed = d.figmaUrl ? figmaEmbedUrl(d.figmaUrl) : null;
  return (
    <Card title="Figma">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => updateTicketAction(d.card.id, { figmaUrl: url.trim() || null }));
        }}
      >
        <label className="sr-only" htmlFor="figma-url">
          Figma link
        </label>
        <input id="figma-url" className="input flex-1" placeholder="https://www.figma.com/design/…" value={url} disabled={!editable} onChange={(e) => setUrl(e.target.value)} />
        {editable && (
          <button className="btn btn-sm ds-btn-navy" disabled={pending || url.trim() === (d.figmaUrl ?? "")}>
            Save
          </button>
        )}
      </form>
      {d.figmaUrl && (
        <a href={d.figmaUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--ds-navy)] hover:underline">
          Open in Figma <ExternalLink size={13} />
        </a>
      )}
      <div className="mt-4">
        {embed ? (
          <iframe title="Figma preview" src={embed} className="h-[450px] w-full rounded-lg border border-[var(--ds-line)]" allowFullScreen />
        ) : (
          <p className="text-sm ds-muted">{d.figmaUrl ? "This link can't be shown here; open it in Figma." : "Paste a Figma file, design or prototype link to see it here."}</p>
        )}
      </div>
    </Card>
  );
}
