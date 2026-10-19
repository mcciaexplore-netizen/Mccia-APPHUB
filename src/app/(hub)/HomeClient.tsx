"use client";

import { useMemo, useState } from "react";
import { Inbox, Search } from "lucide-react";
import { AppCard, type CardApp } from "@/components/AppCard";

/** A card for a part of the hub itself (Approval System, Administrator, ...), opened in the same tab. */
export type HubCard = { id: string; name: string; description: string; icon: string; href: string };

/** Every card on one panel: the hub's own parts first, then the applications, with a search over all of them. */
export function HomeClient({ cards, apps, isAdmin }: { cards: HubCard[]; apps: CardApp[]; isAdmin: boolean }) {
  const [q, setQ] = useState("");
  const t = q.trim().toLowerCase();
  const match = (name: string, description: string | null) => !t || `${name} ${description ?? ""}`.toLowerCase().includes(t);
  const shownCards = useMemo(() => cards.filter((c) => match(c.name, c.description)), [cards, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownApps = useMemo(() => apps.filter((a) => match(a.name, a.description)), [apps, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = shownCards.length + shownApps.length;

  if (cards.length === 0 && apps.length === 0) {
    return (
      <div className="alert mx-auto mt-10 max-w-lg"><Inbox size={18} className="mt-0.5 shrink-0" />
        <span>No applications have been assigned to you yet. Please ask the administrator for access.</span></div>
    );
  }

  return (
    <div>
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl text-ink sm:text-3xl">{t ? "Search results" : "Applications"}</h1>
          <p className="mt-1 text-sm text-subtle">{total} {total === 1 ? "application" : "applications"} {t ? "found" : "available"}</p>
        </div>
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search applications</span>
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle" />
          <input className="input !pl-10" placeholder="Search applications" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </header>

      {total === 0 ? (
        <div className="alert"><Inbox size={18} className="mt-0.5 shrink-0" /><span>No applications match your search.</span></div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-6">
          {shownCards.map((c, i) => <AppCard key={c.id} app={c} index={i} href={c.href} cta="Open" />)}
          {shownApps.map((a, i) => <AppCard key={a.id} app={a} index={shownCards.length + i} canOpenUnavailable={isAdmin} />)}
        </div>
      )}
    </div>
  );
}
