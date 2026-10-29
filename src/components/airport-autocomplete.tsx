"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { MapPin, Plane, Search } from "lucide-react";

export interface AirportSuggestion {
  code: string;
  name: string;
  city: string;
  country: string;
  countryName: string;
  scheduled: boolean;
  type: string;
}

function useAirportSuggestions(query: string, open: boolean) {
  const [airports, setAirports] = useState<AirportSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (!open || !term) {
      setAirports([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/airports?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const data = await response.json() as { airports?: AirportSuggestion[] };
        if (response.ok) setAirports(data.airports ?? []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setAirports([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, open]);

  return { airports, loading };
}

function AirportOptions({ airports, loading, activeIndex, onChoose, onHover }: {
  airports: AirportSuggestion[];
  loading: boolean;
  activeIndex: number;
  onChoose: (airport: AirportSuggestion) => void;
  onHover: (index: number) => void;
}) {
  return <div className="absolute left-0 right-0 top-full z-[60] mt-1 overflow-hidden rounded-xl border border-[#dce5dd] bg-white shadow-xl">
    {loading && <p role="status" className="px-3.5 py-3 text-xs text-[#65736b]">Buscando aeropuertos…</p>}
    {!loading && airports.length === 0 && <p className="px-3.5 py-3 text-xs text-[#65736b]">No hay coincidencias de aeropuerto.</p>}
    {airports.length > 0 && <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
      {airports.map((airport, index) => <li key={airport.code} role="presentation">
        <button type="button" role="option" aria-selected={index === activeIndex} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => onChoose(airport)} className={`flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition ${index === activeIndex ? "bg-[#edf5ef]" : "hover:bg-[#f6f8f5]"}`}>
          <span className="mt-0.5 flex h-9 min-w-12 items-center justify-center rounded-lg bg-[#eaf3ec] px-1.5 text-xs font-bold tracking-wide text-[#176d4f]">{airport.code}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#23332a]">{airport.name}</span><span className="mt-0.5 flex items-center gap-1 text-xs text-[#65736b]"><MapPin size={12} className="shrink-0"/><span className="truncate">{[airport.city, airport.countryName].filter(Boolean).join(", ")}</span></span></span>
          {airport.scheduled && <Plane size={14} className="mt-1 shrink-0 text-[#6f8175]" aria-label="Con vuelos programados"/>}
        </button>
      </li>)}
    </ul>}
  </div>;
}

function airportLabel(airport: AirportSuggestion) {
  return `${airport.code} — ${airport.name}${airport.city ? ` · ${airport.city}` : ""}`;
}

export function AirportAutocomplete({ value, onChange, placeholder, ariaLabel }: {
  value: string;
  onChange: (code: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [text, setText] = useState(value);
  const [selected, setSelected] = useState<AirportSuggestion | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { airports, loading } = useAirportSuggestions(text, open);

  useEffect(() => {
    if (!value || selected?.code === value) return;
    const controller = new AbortController();
    void fetch(`/api/airports?q=${encodeURIComponent(value)}`, { signal: controller.signal })
      .then((response) => response.json() as Promise<{ airports?: AirportSuggestion[] }>)
      .then((data) => {
        const airport = data.airports?.find((item) => item.code === value);
        if (airport) { setSelected(airport); setText(airportLabel(airport)); }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [value, selected?.code]);

  function choose(airport: AirportSuggestion) {
    setSelected(airport); setText(airportLabel(airport)); onChange(airport.code); setOpen(false); setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && open && airports.length) { event.preventDefault(); setActiveIndex((index) => (index + 1) % airports.length); }
    else if (event.key === "ArrowUp" && open && airports.length) { event.preventDefault(); setActiveIndex((index) => (index - 1 + airports.length) % airports.length); }
    else if (event.key === "Enter" && open && airports[activeIndex]) { event.preventDefault(); choose(airports[activeIndex]); }
    else if (event.key === "Escape") setOpen(false);
  }

  return <div className="relative">
    <div className="relative"><input ref={inputRef} role="combobox" aria-label={ariaLabel} aria-autocomplete="list" aria-expanded={open} aria-controls={`airport-options-${ariaLabel.replace(/\W+/g, "-")}`} autoComplete="off" className="focus-ring h-11 w-full rounded-xl border border-[#dce4dd] bg-white px-3.5 pr-9 text-sm uppercase text-[#1c2a23] outline-none transition placeholder:normal-case placeholder:text-[#a2ada6] focus:border-[#73ad90]" value={text} placeholder={placeholder} onFocus={() => { if (selected && value === selected.code) { setText(selected.code); inputRef.current?.select(); } setOpen(true); }} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={handleKeyDown} onChange={(event) => { const next = event.target.value; setText(next); setSelected(null); onChange(""); setOpen(true); setActiveIndex(0); }}/><Search size={15} className="pointer-events-none absolute right-3 top-3 text-[#7b8981]"/></div>
    {open && <div id={`airport-options-${ariaLabel.replace(/\W+/g, "-")}`}><AirportOptions airports={airports} loading={loading} activeIndex={activeIndex} onChoose={choose} onHover={setActiveIndex}/></div>}
  </div>;
}
