"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cx as clsx } from "@/lib/ivr/cx";
import { CallButton } from "@/components/ivr/call-button";
import { STAGE_ORDER, STAGES, type StageKey } from "@/lib/ivr/stage";

export type CardDTO = {
  id: string;
  name: string;
  phone: string;
  company: string | null;
  category: string | null;
  attempts: number;
  lastOutcome: string | null;
  ownerName: string | null;
};

export type BoardData = Record<StageKey, { cards: CardDTO[]; total: number }>;

function Card({ card, stage, showOwner, onOpen }: { card: CardDTO; stage: StageKey; showOwner: boolean; onOpen: () => void }) {
  return (
    <div className="ivr-tile cursor-pointer px-3.5 py-3 text-left" onClick={onOpen}>
      <p className="truncate text-[13px] font-semibold">{card.name}</p>
      <p className="truncate font-mono text-[11px] text-muted">{card.phone}</p>
      {card.company && <p className="mt-0.5 truncate text-[12px]">{card.company}</p>}
      {card.category && <p className="truncate text-[11px] text-muted">{card.category}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          {card.attempts} {card.attempts === 1 ? "try" : "tries"}
          {card.lastOutcome ? ` · ${card.lastOutcome}` : ""}
        </span>
        {showOwner && <span className="truncate">{card.ownerName ?? "Unassigned"}</span>}
      </div>
      <div className="mt-2">
        <CallButton leadId={card.id} disabled={stage === "closed"} />
      </div>
    </div>
  );
}

/** Read-only board: stages follow the calls, so there is nothing to drag. */
export function KanbanBoard({ initial, showOwner }: { initial: BoardData; showOwner: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const open = (id: string) => {
    const n = new URLSearchParams(sp.toString());
    n.set("lead", id);
    router.push(`${pathname}?${n.toString()}`, { scroll: false });
  };

  return (
    <div className="ivr-stagger flex gap-4 overflow-x-auto pb-4">
      {STAGE_ORDER.map((st) => {
        const s = STAGES[st];
        const col = initial[st];
        return (
          <section
            key={st}
            aria-label={`${s.label} column`}
            className={clsx("flex min-h-[280px] w-[270px] shrink-0 flex-col gap-3 rounded-[20px] border border-line bg-alt p-3")}
            style={{ borderTop: `3px solid ${s.color}` }}
          >
            <h2 className="ivr-label flex items-center justify-between px-1">
              <span title={s.hint}>{s.label}</span>
              <span className="tabular-nums text-muted">{col.total}</span>
            </h2>
            <div className="flex flex-col gap-2">
              {col.cards.map((c) => (
                <Card key={c.id} card={c} stage={st} showOwner={showOwner} onOpen={() => open(c.id)} />
              ))}
              {col.cards.length === 0 && <p className="px-1 py-6 text-center text-[12px] text-muted">Nobody here</p>}
              {col.total > col.cards.length && (
                <p className="px-1 text-center text-[11px] text-muted">
                  Showing {col.cards.length} of {col.total}. Use search to narrow.
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
