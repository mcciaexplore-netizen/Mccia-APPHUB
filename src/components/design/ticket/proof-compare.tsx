"use client";

import { useState } from "react";
import { Card } from "../ui";
import { fileHref } from "../upload";

/** Two image versions side by side, or one over the other with a slider that reveals the newer. */
export function ProofCompare({ proofs }: { proofs: { id: string; version: number }[] }) {
  const [a, setA] = useState(proofs[1].id);
  const [b, setB] = useState(proofs[0].id);
  const [mode, setMode] = useState<"side" | "slider">("side");
  const [pos, setPos] = useState(50);
  const pick = (value: string, set: (v: string) => void, label: string) => (
    <label className="ds-label flex items-center gap-2">
      {label}
      <select className="input w-auto" value={value} onChange={(e) => set(e.target.value)}>
        {proofs.map((p) => (
          <option key={p.id} value={p.id}>
            V{p.version}
          </option>
        ))}
      </select>
    </label>
  );
  const va = proofs.find((p) => p.id === a)?.version;
  const vb = proofs.find((p) => p.id === b)?.version;
  return (
    <Card
      title="Compare versions"
      actions={
        <div role="tablist" aria-label="Compare how" className="ds-tabs">
          {(["side", "slider"] as const).map((m) => (
            <button key={m} type="button" role="tab" className="ds-tab" aria-selected={mode === m} onClick={() => setMode(m)}>
              {m === "side" ? "Side by side" : "Slider"}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-4">
        {pick(a, setA, "Left")}
        {pick(b, setB, "Right")}
      </div>
      {mode === "side" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            [a, va],
            [b, vb],
          ].map(([id, v]) => (
            <figure key={String(id)} className="overflow-hidden rounded-lg border border-[var(--ds-line)] bg-[var(--ds-grey-tint)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileHref(String(id), true)} alt={`Version ${v}`} className="w-full object-contain" />
              <figcaption className="px-3 py-1.5 text-xs font-semibold text-ink">V{v}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div>
          <div className="relative overflow-hidden rounded-lg border border-[var(--ds-line)] bg-[var(--ds-grey-tint)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileHref(a, true)} alt={`Version ${va}`} className="block w-full object-contain" />
            <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileHref(b, true)} alt={`Version ${vb}`} className="block h-full w-full object-contain" />
            </div>
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--ds-navy)]" style={{ left: `${pos}%` }} />
          </div>
          <label className="mt-3 flex items-center gap-3 text-xs ds-muted">
            V{va}
            <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="flex-1 accent-[#003F8A]" aria-label="Reveal" />
            V{vb}
          </label>
        </div>
      )}
    </Card>
  );
}
