"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LocateFixed, MapPin } from "lucide-react";
import { GEOAPIFY_KEY, geoapifySuggest, gpsErrorMessage, nominatimSearch, reverseGeocode, type Found } from "./geo";

export type Place = { text: string; lat: number | null; lng: number | null };

/**
 * An address box with suggestions. With Geoapify (NEXT_PUBLIC_GEOAPIFY_API_KEY), they come as the person types (after 3 letters, 300 ms after
 * typing stops). Without the key, or once Geoapify fails, it searches OpenStreetMap's Nominatim when the person presses Enter (its rules
 * forbid searching on every keystroke). Choosing a suggestion keeps its coordinates; typing again drops them, so text and coordinates never
 * disagree. `locate` adds "Use my location" (high-accuracy GPS, turned into an address). `bare`: no label or border, for a row inside the
 * booking form's location card (the label is then only read out to screen readers).
 */
export function AddressInput({ name, label, value, onChange, placeholder, locate = false, autoFocus = false, bare = false }: {
  name: string; label: string; value: Place; onChange: (p: Place) => void; placeholder?: string; locate?: boolean; autoFocus?: boolean; bare?: boolean;
}) {
  const listId = useId();
  const [items, setItems] = useState<Found[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // Geoapify could not be used (no key, or it failed): search Nominatim on Enter instead.
  const [fallback, setFallback] = useState(!GEOAPIFY_KEY);
  const [searching, setSearching] = useState(false);
  const typed = useRef(false);

  useEffect(() => {
    const q = value.text.trim();
    if (fallback || !typed.current || q.length < 3 || value.lat != null) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const found = await geoapifySuggest(q, ctl.signal);
        setItems(found); setOpen(true); setActive(-1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setFallback(true); // Geoapify is down or refused the key: Nominatim from now on
      }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [value.text, value.lat, fallback]);

  const search = async () => {
    const q = value.text.trim();
    if (q.length < 3) { setNote("Type at least 3 letters, then press Enter to search."); return; }
    setSearching(true); setNote("");
    try {
      const found = await nominatimSearch(q);
      setItems(found); setOpen(true); setActive(-1);
      if (!found.length) setNote("No address found near Pune. Check the spelling, or keep what you typed.");
    } catch { setNote("Address search is not available right now. You can keep what you typed."); }
    finally { setSearching(false); }
  };

  const choose = (f: Found) => { typed.current = false; onChange({ text: f.text.slice(0, 200), lat: f.lat, lng: f.lng }); setOpen(false); setNote(""); };

  const useMine = () => {
    if (!navigator.geolocation) { setNote("This browser cannot share its location."); return; }
    setBusy(true); setNote("");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const lat = Number(coords.latitude.toFixed(7)), lng = Number(coords.longitude.toFixed(7));
      const text = (await reverseGeocode(lat, lng)) ?? `${lat}, ${lng}`;
      typed.current = false; onChange({ text: text.slice(0, 200), lat, lng }); setBusy(false);
    }, (e) => { setBusy(false); setNote(gpsErrorMessage(e.code)); },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  };

  const key = (e: React.KeyboardEvent) => {
    // Without Geoapify, Enter searches (and never sends the booking form by accident).
    if (fallback && e.key === "Enter" && !(open && active >= 0)) { e.preventDefault(); void search(); return; }
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="relative">
      {!bare && <span className="label-xs mb-1.5 flex items-center justify-between"><span>{label}</span>
        {locate && <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold normal-case tracking-normal text-primary" onClick={useMine} disabled={busy}><LocateFixed size={13} /> {busy ? "Finding you…" : "Use my location"}</button>}</span>}
      {bare && locate && <button type="button" className="absolute right-0 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[#2a6b7c] hover:bg-[#e8f3f5]"
        onClick={useMine} disabled={busy} aria-label="Use my location" title="Use my location"><LocateFixed size={18} className={busy ? "animate-pulse" : ""} /></button>}
      <input className={bare ? `w-full bg-transparent py-3 text-base text-ink outline-none placeholder:text-subtle ${locate ? "pr-12" : ""}` : "input"} name={name} value={value.text} placeholder={placeholder} maxLength={200} required autoFocus={autoFocus} autoComplete="off"
        role="combobox" aria-expanded={open && items.length > 0} aria-controls={listId} aria-autocomplete="list" aria-label={label}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { typed.current = true; onChange({ text: e.target.value, lat: null, lng: null }); }} onKeyDown={key} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-white shadow-card">
          {items.map((f, i) => (
            <li key={`${f.lat},${f.lng},${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" className={`flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm ${i === active ? "bg-blue-tint" : "hover:bg-alt"}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(f)}>
                <MapPin size={14} className="mt-0.5 shrink-0 text-subtle" aria-hidden />{f.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.lat != null && !bare && <p className="mt-1 text-xs text-brand-green-text" data-located={name}>Location set on the map.</p>}
      {value.lat != null && bare && <span className="sr-only" data-located={name}>Location set on the map.</span>}
      {fallback && value.lat == null && value.text.trim().length >= 3 && !open && !note && <p className="mt-1 text-xs text-muted">{searching ? "Searching…" : "Press Enter to search addresses."}</p>}
      {note && <p className="mt-1 text-xs text-[#b45309]" role="status">{note}</p>}
    </div>
  );
}
