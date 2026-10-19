"use client";

import { useMemo, useState } from "react";
import { Inbox, Search, X } from "lucide-react";
import { AppCard, type CardApp } from "@/components/AppCard";

/** A card for a part of the hub itself (Approval System, Administrator, ...), opened in the same tab. */
export type HubCard = { id: string; name: string; description: string; icon: string; href: string };

type Filter = "all" | "hub" | "apps";

/** Every card on one panel, with a welcome line, a search and a filter: the hub's own parts first, then the applications. */
export function HomeClient({ name, cards, apps, isAdmin }: { name: string; cards: HubCard[]; apps: CardApp[]; isAdmin: boolean }) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const t = q.trim().toLowerCase();
  const match = (n: string, d: string | null) => !t || `${n} ${d ?? ""}`.toLowerCase().includes(t);
  const shownCards = useMemo(() => (filter === "apps" ? [] : cards.filter((c) => match(c.name, c.description))), [cards, t, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownApps = useMemo(() => (filter === "hub" ? [] : apps.filter((a) => match(a.name, a.description))), [apps, t, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const none = shownCards.length + shownApps.length === 0;

  return (
    <div>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-medium text-ink sm:text-2xl">Welcome, {name}</h1>
        <div className="flex items-center gap-2">
          {searching ? (
            <label className="relative block w-full sm:w-64">
              <span className="sr-only">Search applications</span>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
              <input autoFocus className="input !h-10 !py-0 !pl-9 !pr-9" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="button" aria-label="Close search" onClick={() => { setQ(""); setSearching(false); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle hover:text-ink"><X size={15} /></button>
            </label>
          ) : (
            <button type="button" aria-label="Search applications" onClick={() => setSearching(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-gray-200 bg-gradient-to-b from-white to-slate-50 text-muted shadow-[0_2px_6px_rgba(15,23,42,0.08)] hover:text-primary"><Search size={16} /></button>
          )}
          <label className="sr-only" htmlFor="home-filter">Show</label>
          <select id="home-filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="input !h-10 !w-56 !py-0">
            <option value="all">All apps</option>
            <option value="hub">Hub features</option>
            <option value="apps">Applications</option>
          </select>
        </div>
      </header>

      {cards.length === 0 && apps.length === 0 ? (
        <div className="alert mx-auto mt-10 max-w-lg"><Inbox size={18} className="mt-0.5 shrink-0" /><span>No applications have been assigned to you yet. Please ask the administrator for access.</span></div>
      ) : none ? (
        <div className="alert"><Inbox size={18} className="mt-0.5 shrink-0" /><span>No applications match.</span></div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shownCards.map((c, i) => <AppCard key={c.id} app={c} index={i} href={c.href} kind="Hub feature" />)}
          {shownApps.map((a, i) => <AppCard key={a.id} app={a} index={shownCards.length + i} canOpenUnavailable={isAdmin} />)}
        </div>
      )}
    </div>
  );
}
