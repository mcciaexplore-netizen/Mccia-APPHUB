"use client";

import { useEffect, useId, useRef, useState } from "react";

export type PickedAgent = { id: string; name: string; email: string };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/**
 * Typeahead over the hub's active users who are not linked to a Smartflo agent yet (GET /api/ivr/agents/search). Type to search by
 * name or email; pick with the mouse, or with the arrow keys and Enter. Escape or a click outside closes the list. Typing again after a pick
 * clears it, so `onPick(null)` always means "nothing chosen".
 */
export function AgentPicker({ label, disabled, picked, onPick }: { label: string; disabled?: boolean; picked: PickedAgent | null; onPick: (p: PickedAgent | null) => void }) {
  const [text, setText] = useState(picked?.name ?? "");
  const [items, setItems] = useState<PickedAgent[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optId = (i: number) => `${listId}-opt-${i}`;

  // A pick cleared from outside (after "Add agent") empties the box too.
  const [lastPicked, setLastPicked] = useState(picked);
  if (picked !== lastPicked) {
    setLastPicked(picked);
    if (!picked) setText("");
  }

  useEffect(() => {
    const q = text.trim();
    if (!q || picked?.name === text) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/ivr/agents/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal, cache: "no-store" });
        const rows = res.ok ? ((await res.json()) as PickedAgent[]) : [];
        setItems(rows);
        setActive(rows.length ? 0 : -1);
        setOpen(true);
      } catch {
        /* a newer search took over, or offline for a moment */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => { ctrl.abort(); clearTimeout(t); };
  }, [text, picked]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (p: PickedAgent) => {
    onPick(p);
    setText(p.name);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? items.length - 1 : i - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(items[active]); }
  };

  const showList = open && !!text.trim() && !(picked && picked.name === text);
  return (
    <div ref={box} className="relative grid w-80 gap-1">
      <label htmlFor={`${listId}-input`} className="ivr-label">{label}</label>
      <input
        id={`${listId}-input`}
        className="input font-normal text-ink"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? optId(active) : undefined}
        autoComplete="off"
        placeholder="Start typing a name or email"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (picked) onPick(null);
          if (!e.target.value.trim()) { setItems([]); setOpen(false); }
        }}
        onFocus={() => { if (items.length && !picked) setOpen(true); }}
        onKeyDown={onKey}
      />
      {showList && (
        <ul id={listId} role="listbox" aria-label="Hub users" className="absolute top-full left-0 z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-[12px] border border-line bg-white py-1 shadow-[0_14px_34px_rgba(15,23,42,0.13)]">
          {items.length === 0 ? (
            <li className="px-3 py-2.5 text-[13px] text-muted">{loading ? "Searching…" : "Nobody in the hub matches, or they are already linked."}</li>
          ) : (
            items.map((p, i) => (
              <li
                key={p.id}
                id={optId(i)}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(p); }}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? "bg-[#f0f7f9]" : ""}`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#2a6b7c] text-[0.72rem] font-bold text-white" aria-hidden>{initials(p.name)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                  <span className="block truncate text-[12px] text-muted">{p.email}</span>
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
