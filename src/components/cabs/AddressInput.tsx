"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, LocateFixed, MapPin } from "lucide-react";
import { GEOAPIFY_KEY, geoapifySuggest, gpsErrorMessage, hubSearch, nominatimSearch, reverseGeocode, type Found } from "./geo";
import { officeText, officesFor, type Office } from "./offices";

export type Place = { text: string; lat: number | null; lng: number | null };

/**
 * An address box with suggestions, as the person types (after 3 letters, 300 ms after typing stops): from the hub's own address search
 * (Photon, Pune and Pimpri-Chinchwad first; see src/lib/cabs/places.ts), each as its name over its kind and area. Enter searches harder
 * (Nominatim too). If the hub's search cannot answer, Geoapify takes over (with NEXT_PUBLIC_GEOAPIFY_API_KEY), and failing that the box
 * searches OpenStreetMap's Nominatim from the browser when the person presses Enter (its rules forbid searching on every keystroke). Choosing a suggestion keeps its coordinates; typing again drops them, so text and coordinates never
 * disagree. `locate` adds "Use my location" (high-accuracy GPS, turned into an address). `bare`: no label or border, for a row inside the
 * booking form's location card (the label is then only read out to screen readers).
 *
 * MCCIA's offices come first, as quick picks: all of them when the box is focused and (almost) empty, and those that match when the text
 * mentions "MCCIA", "office" or "cluster" (see offices.ts); address suggestions follow below them.
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
  // Which search answers as the person types: the hub's, then Geoapify (with its key) if that fails, then none.
  const [provider, setProvider] = useState<"hub" | "geoapify" | "none">("hub");
  // Neither could be used: search Nominatim from the browser on Enter instead.
  const fallback = provider === "none";
  const [searching, setSearching] = useState(false);
  const typed = useRef(false);
  // Whether the list may show: on focus and while typing; not once something has been chosen, nor after Escape or leaving the box.
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    const q = value.text.trim();
    if (fallback || !typed.current || q.length < 3 || value.lat != null) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const found = provider === "hub" ? await hubSearch(q, false, ctl.signal) : await geoapifySuggest(q, ctl.signal);
        setItems(found); setOpen(true); setActive(-1);
        setNote(found.length ? "" : provider === "hub" ? "No match nearby yet. Keep typing, or press Enter to search harder." : "");
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          // The search is down (or Geoapify refused its key): the next one along. Said in the console, with the reason but never a key.
          console.warn(`[cabs] ${provider === "hub" ? "Address" : "Geoapify address"} suggestions failed (${(e as Error).message}); trying the next search.`);
          setProvider(provider === "hub" && GEOAPIFY_KEY ? "geoapify" : "none");
        }
      }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [value.text, value.lat, fallback, provider]);

  // Enter: a thorough search (the hub's, with Nominatim too), or Nominatim from the browser when the hub's search is not answering.
  const search = async () => {
    const q = value.text.trim();
    if (q.length < 3) { setNote("Type at least 3 letters, then press Enter to search."); return; }
    setSearching(true); setNote("");
    try {
      const found = provider === "hub" ? await hubSearch(q, true).catch(() => nominatimSearch(q)) : await nominatimSearch(q);
      setItems(found); setOpen(true); setActive(-1);
      if (!found.length) setNote("No address found near Pune. Check the spelling, or keep what you typed.");
    } catch { setNote("Address search is not available right now. You can keep what you typed."); }
    finally { setSearching(false); }
  };

  const choose = (f: Found) => { typed.current = false; onChange({ text: f.text.slice(0, 200), lat: f.lat, lng: f.lng }); setOpen(false); setListOpen(false); setNote(""); };
  const chooseOffice = (o: Office) => choose({ text: officeText(o), lat: o.lat, lng: o.lng });

  // Everything the list shows, offices first, as one run for the arrow keys.
  const offices = listOpen && value.lat == null ? officesFor(value.text) : [];
  const suggestions = listOpen && open ? items : [];
  const options: ({ kind: "office"; office: Office } | { kind: "place"; place: Found })[] = [
    ...offices.map((office) => ({ kind: "office" as const, office })), ...suggestions.map((place) => ({ kind: "place" as const, place })),
  ];
  const pick = (i: number) => {
    const o = options[i];
    if (o?.kind === "office") chooseOffice(o.office);
    else if (o) choose(o.place);
  };

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
    if (e.key === "Enter" && options.length && active >= 0) { e.preventDefault(); pick(active); return; }
    // Enter searches harder (and never sends the booking form by accident); Geoapify has nothing more to give.
    if (provider !== "geoapify" && e.key === "Enter") { e.preventDefault(); void search(); return; }
    if (!options.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? options.length - 1 : a - 1)); }
    else if (e.key === "Escape") { setListOpen(false); setOpen(false); }
  };
  const optionClass = (i: number) => `flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm ${i === active ? "bg-blue-tint" : "hover:bg-alt"}`;

  return (
    <div className="relative">
      {!bare && <span className="label-xs mb-1.5 flex items-center justify-between"><span>{label}</span>
        {locate && <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold normal-case tracking-normal text-primary" onClick={useMine} disabled={busy}><LocateFixed size={13} /> {busy ? "Finding you…" : "Use my location"}</button>}</span>}
      {bare && locate && <button type="button" className="absolute right-0 top-1/2 z-10 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[#2a6b7c] hover:bg-[#e8f3f5]"
        onClick={useMine} disabled={busy} aria-label="Use my location" title="Use my location"><LocateFixed size={18} className={busy ? "animate-pulse" : ""} /></button>}
      <input className={bare ? `w-full bg-transparent py-3 text-base text-ink outline-none placeholder:text-subtle ${locate ? "pr-12" : ""}` : "input"} name={name} value={value.text} placeholder={placeholder} maxLength={200} required autoFocus={autoFocus} autoComplete="off"
        role="combobox" aria-expanded={options.length > 0} aria-controls={listId} aria-autocomplete="list" aria-label={label}
        aria-activedescendant={active >= 0 && active < options.length ? `${listId}-${active}` : undefined}
        onFocus={() => { setListOpen(true); setActive(-1); }}
        // A tap on a box that already has focus (the pickup box is focused as the page opens) opens its list too.
        onClick={() => setListOpen(true)}
        onChange={(e) => { typed.current = true; setListOpen(true); setActive(-1); onChange({ text: e.target.value, lat: null, lng: null }); }} onKeyDown={key}
        // Closed at once on leaving the box: a tap on an option does not take the focus away (each option stops it), so nothing is lost.
        onBlur={() => { setOpen(false); setListOpen(false); }} />
      {options.length > 0 && (
        <div id={listId} role="listbox" aria-label={`${label}: suggestions`} className="absolute inset-x-0 z-20 mt-1 max-h-80 overflow-auto rounded-lg border border-line bg-white shadow-card">
          {offices.length > 0 && <p className="px-3 pb-1 pt-2.5 text-[0.68rem] font-bold uppercase tracking-widest text-muted" aria-hidden>MCCIA Offices</p>}
          {offices.map((o, i) => (
            <div key={o.name} id={`${listId}-${i}`} role="option" aria-selected={i === active} aria-label={o.name} data-office={o.name}>
              <button type="button" tabIndex={-1} className={optionClass(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => chooseOffice(o)}>
                <Building2 size={16} className="mt-0.5 shrink-0 text-[#2a6b7c]" aria-hidden />
                <span className="min-w-0"><b className="block text-[#2a6b7c]">{o.name}</b><span className="block truncate text-xs text-muted">{o.address}</span></span>
              </button>
            </div>
          ))}
          {offices.length > 0 && suggestions.length > 0 && <div className="mx-3 border-t border-line" aria-hidden />}
          {suggestions.map((f, j) => {
            const i = offices.length + j;
            return (
              <div key={`${f.lat},${f.lng},${j}`} id={`${listId}-${i}`} role="option" aria-selected={i === active} aria-label={f.text}>
                <button type="button" tabIndex={-1} className={optionClass(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(f)}>
                  <MapPin size={14} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
                  {f.main ? <span className="min-w-0"><span className="block font-semibold text-ink">{f.main}</span>{f.secondary && <span className="block truncate text-xs text-muted">{f.secondary}</span>}</span> : f.text}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {value.lat != null && !bare && <p className="mt-1 text-xs text-brand-green-text" data-located={name}>Location set on the map.</p>}
      {value.lat != null && bare && <span className="sr-only" data-located={name}>Location set on the map.</span>}
      {fallback && value.lat == null && value.text.trim().length >= 3 && !open && !note && <p className="mt-1 text-xs text-muted">{searching ? "Searching…" : "Press Enter to search addresses."}</p>}
      {note && <p className="mt-1 text-xs text-[#b45309]" role="status">{note}</p>}
    </div>
  );
}
