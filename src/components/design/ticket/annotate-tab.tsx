"use client";

import { useRef, useState } from "react";
import { Check, RotateCcw, Trash2 } from "lucide-react";
import type { TicketDetail } from "@/lib/design/detail";
import { addPinAction, setPinAction } from "@/lib/design/actions/tickets";
import { isImage } from "@/lib/design/file-types";
import { Card, Empty, formatDateTime } from "../ui";
import { fileHref } from "../upload";
import { useAct } from "./use-act";
import type { Viewer } from "./ticket-view";

/** Tab 5: click a spot on an image proof to pin a numbered comment there; pins can be resolved, reopened and removed. */
export function AnnotateTab({ d, viewer }: { d: TicketDetail; viewer: Viewer }) {
  const images = d.proofs.filter((p) => isImage(p.file.mime));
  const [proofId, setProofId] = useState(images[0]?.id ?? "");
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState("");
  const { act, pending } = useAct();
  const img = useRef<HTMLImageElement>(null);

  if (!images.length) {
    return (
      <Card title="Annotate">
        <Empty title="No image proofs yet">Upload an image proof (Proofs &amp; approval) to pin comments on it.</Empty>
      </Card>
    );
  }
  const proof = images.find((p) => p.id === proofId) ?? images[0];
  const pins = d.pins.filter((p) => p.proofVersionId === proof.id);

  const place = (e: React.MouseEvent<HTMLImageElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    setDraft({ x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) });
    setText("");
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Card
        title="Click the design where something should change"
        actions={
          <label className="ds-label flex items-center gap-2">
            Proof
            <select className="input w-auto" value={proof.id} onChange={(e) => (setProofId(e.target.value), setDraft(null))}>
              {images.map((p) => (
                <option key={p.id} value={p.id}>
                  V{p.version}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <div className="relative inline-block w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={img} src={fileHref(proof.file.id, true)} alt={`Version ${proof.version}`} className="block w-full cursor-crosshair rounded-lg" onClick={place} />
          {pins.map((p, i) => (
            <span key={p.id} className="ds-pin" data-resolved={p.resolved} style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }} title={p.content}>
              {i + 1}
            </span>
          ))}
          {draft && (
            <>
              <span className="ds-pin" style={{ left: `${draft.x}%`, top: `${draft.y}%`, background: "var(--ds-navy)" }}>
                {pins.length + 1}
              </span>
              <form
                className="absolute z-10 w-64 rounded-lg border border-[var(--ds-line)] bg-white p-3 shadow-lg"
                style={{ left: `min(${draft.x}%, calc(100% - 16rem))`, top: `calc(${draft.y}% + 18px)` }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await act(() => addPinAction(proof.id, draft.x, draft.y, text), { quiet: true });
                  if (r.ok) setDraft(null);
                }}
              >
                <label className="ds-label flex flex-col gap-1">
                  What should change here?
                  <textarea className="input min-h-20" autoFocus value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
                </label>
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                  <button className="btn btn-sm ds-btn-navy" disabled={pending || !text.trim()}>
                    Pin it
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </Card>
      <Card title={`Pins on V${proof.version} (${pins.length})`}>
        {pins.length === 0 ? (
          <p className="text-sm ds-muted">No pins yet. Click the design to add one.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {pins.map((p, i) => (
              <li key={p.id} className="flex gap-3 text-sm">
                <span className="ds-pin shrink-0" data-resolved={p.resolved} style={{ position: "relative", transform: "none" }}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block whitespace-pre-wrap ${p.resolved ? "line-through ds-muted" : "text-ink"}`}>{p.content}</span>
                  <span className="text-xs ds-muted">
                    {p.author ?? "Unknown"} · {formatDateTime(p.at)}
                  </span>
                </span>
                <span className="flex shrink-0 items-start gap-1">
                  <button type="button" className="rounded p-1 text-subtle hover:text-ink" aria-label={p.resolved ? "Reopen pin" : "Resolve pin"} title={p.resolved ? "Reopen" : "Resolve"} disabled={pending} onClick={() => act(() => setPinAction(p.id, !p.resolved), { quiet: true })}>
                    {p.resolved ? <RotateCcw size={15} /> : <Check size={15} />}
                  </button>
                  {(viewer.lead || p.author) && (
                    <button type="button" className="rounded p-1 text-subtle hover:text-[var(--ds-red)]" aria-label="Delete pin" disabled={pending} onClick={() => act(() => setPinAction(p.id, null), { quiet: true })}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
