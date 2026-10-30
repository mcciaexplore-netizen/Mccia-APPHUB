"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LocateFixed, MapPin } from "lucide-react";

export type Place = { text: string; lat: number | null; lng: number | null };

const KEY = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY ?? "";
/** Suggestions in India, nearest Pune first. */
const SEARCH = "https://api.geoapify.com/v1/geocode/autocomplete";
const REVERSE = "https://api.geoapify.com/v1/geocode/reverse";
type Feature = { properties: { formatted: string; lat: number; lon: number } };

/**
 * An address box with Geoapify suggestions (after 3 letters, 300 ms after typing stops). Choosing one keeps its coordinates; typing again
 * drops them, so text and coordinates never disagree. `locate` adds "Use my location" (the browser's position, turned into an address).
 * Without NEXT_PUBLIC_GEOAPIFY_API_KEY it is a plain text box.
 */
export function AddressInput({ name, label, value, onChange, placeholder, locate = false, autoFocus = false }: {
  name: string; label: string; value: Place; onChange: (p: Place) => void; placeholder?: string; locate?: boolean; autoFocus?: boolean;
}) {
  const listId = useId();
  const [items, setItems] = useState<Feature[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const typed = useRef(false);

  useEffect(() => {
    const q = value.text.trim();
    if (!KEY || !typed.current || q.length < 3 || value.lat != null) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ text: q, apiKey: KEY, filter: "countrycode:in", bias: "proximity:73.8567,18.5204", limit: "6", format: "geojson" });
        const res = await fetch(`${SEARCH}?${p}`, { signal: ctl.signal });
        const data = (await res.json()) as { features?: Feature[] };
        setItems(data.features ?? []); setOpen(true); setActive(-1);
      } catch { /* aborted, or offline: no suggestions */ }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [value.text, value.lat]);

  const choose = (f: Feature) => { typed.current = false; onChange({ text: f.properties.formatted, lat: f.properties.lat, lng: f.properties.lon }); setOpen(false); };

  const useMine = () => {
    if (!navigator.geolocation) { setNote("This browser cannot share its location."); return; }
    setBusy(true); setNote("");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const lat = Number(coords.latitude.toFixed(7)), lng = Number(coords.longitude.toFixed(7));
      let text = `${lat}, ${lng}`;
      if (KEY) {
        try {
          const res = await fetch(`${REVERSE}?${new URLSearchParams({ lat: String(lat), lon: String(lng), apiKey: KEY, format: "geojson" })}`);
          text = ((await res.json()) as { features?: Feature[] }).features?.[0]?.properties.formatted ?? text;
        } catch { /* keep the coordinates as the text */ }
      }
      typed.current = false; onChange({ text: text.slice(0, 200), lat, lng }); setBusy(false);
    }, (e) => { setBusy(false); setNote(e.code === e.PERMISSION_DENIED ? "Location is blocked for this site. Allow it in the browser, or type the address." : "Your location could not be found. Type the address."); },
    { enableHighAccuracy: true, timeout: 15000 });
  };

  const key = (e: React.KeyboardEvent) => {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="relative">
      <span className="label-xs mb-1.5 flex items-center justify-between"><span>{label}</span>
        {locate && <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold normal-case tracking-normal text-primary" onClick={useMine} disabled={busy}><LocateFixed size={13} /> {busy ? "Finding you…" : "Use my location"}</button>}</span>
      <input className="input" name={name} value={value.text} placeholder={placeholder} maxLength={200} required autoFocus={autoFocus} autoComplete="off"
        role="combobox" aria-expanded={open && items.length > 0} aria-controls={listId} aria-autocomplete="list" aria-label={label}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { typed.current = true; onChange({ text: e.target.value, lat: null, lng: null }); }} onKeyDown={key} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-line bg-white shadow-card">
          {items.map((f, i) => (
            <li key={`${f.properties.lat},${f.properties.lon}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" className={`flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm ${i === active ? "bg-blue-tint" : "hover:bg-alt"}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(f)}>
                <MapPin size={14} className="mt-0.5 shrink-0 text-subtle" aria-hidden />{f.properties.formatted}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.lat != null && <p className="mt-1 text-xs text-brand-green-text" data-located={name}>Location set on the map.</p>}
      {note && <p className="mt-1 text-xs text-[#b45309]">{note}</p>}
    </div>
  );
}
