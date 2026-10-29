"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDownUp, ArrowLeftRight, ArrowRight, Bell, CalendarDays, Check, ChevronDown, Eye, EyeOff,
  CircleAlert, Clock3, Compass, ExternalLink, History, LockKeyhole, Mail, MapPin, Minus,
  MoreHorizontal, Pause, Plane, Plus, Play, RefreshCw, ScrollText, Search, Settings2, ShieldCheck,
  Sparkles, Trash2, TrendingDown, X, Power, RotateCw, Square,
} from "lucide-react";
import type { AppSettings, FollowUp, FollowUpInput, RunWithResults } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { dateRange } from "@/lib/dates";
import { AirportAutocomplete } from "@/components/airport-autocomplete";

type PageKey = "overview" | "followups" | "history" | "settings" | "diagnostics";
type VaultState = { configured: boolean; unlocked: boolean; remembered?: boolean };
type EmailJsCredentials = { serviceId: string; templateId: string; publicKey: string; privateKey: string };
type ApiError = { error?: string };
type DiagnosticLog = { id: string; createdAt: string; area: string; event: string; outcome: "info" | "success" | "warning" | "error"; message: string };
type RunnerProgress = { phase: string; completed: number; total: number; current?: string; destinationProgress?: Array<{ destinationIata: string; completed: number; total: number }> };
type RunnerViewState = { running: boolean; currentLabel: string | null; currentRunId: string | null; startedAt: string | null; progress: RunnerProgress | null };
type LifecycleAction = "idle" | "stopping" | "restarting";
const restartSessionKey = "vuela_restart_pending";

function delay(milliseconds: number) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }

function bogotaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addIsoDays(value: string, days: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function tomorrowBogota() { return addIsoDays(bogotaToday(), 1); }

function closeCurrentTab() {
  try { window.close(); } catch { /* Chrome can block closing a tab opened outside JavaScript. */ }
  window.setTimeout(() => { if (!window.closed) window.location.replace("about:blank"); }, 350);
}

function broadcastLifecycle(action: "stop" | "reload") {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("vuela-lifecycle");
  channel.postMessage(action);
  channel.close();
}

const navItems: Array<{ key: PageKey; title: string; icon: typeof Activity }> = [
  { key: "overview", title: "Resumen", icon: Activity },
  { key: "followups", title: "Seguimientos", icon: Plane },
  { key: "history", title: "Historial", icon: History },
  { key: "settings", title: "Configuración", icon: Settings2 },
  { key: "diagnostics", title: "Diagnóstico", icon: ScrollText },
];

const emptyForm = (): FollowUpInput => ({
  name: "", originIata: "", destinationIata: "", destinationIatas: [], mode: "standard", lookaheadDays: 120, minNoticeHours: 8, tripType: "round_trip",
  outboundMode: "exact", outboundStart: "", outboundEnd: "",
  inboundMode: "exact", inboundStart: "", inboundEnd: "", stayNights: null,
  adults: 1, maxPriceCop: 500000, status: "active",
});

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(data.error ?? "No se pudo completar la solicitud.");
  return data;
}

function formatDate(value: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00.000Z`);
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota", ...(opts ?? {}) }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const parts = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h12", timeZone: "America/Bogota" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")} ${part("month").toUpperCase()} ${part("hour")}:${part("minute")} ${part("dayPeriod").toLowerCase()}`;
}

function formatElapsed(startedAt: string, finishedAt?: string | null) {
  const minutes = Math.max(0, Math.floor(((finishedAt ? new Date(finishedAt) : new Date()).getTime() - new Date(startedAt).getTime()) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatProcessingDuration(startedAt: string, finishedAt?: string | null) {
  const totalSeconds = Math.max(0, Math.floor(((finishedAt ? new Date(finishedAt) : new Date()).getTime() - new Date(startedAt).getTime()) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours ? `${hours}h ` : ""}${minutes}m ${seconds}s`;
}

function bogotaDateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Bogota" }).format(new Date(value));
}

function formatCop(value: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function formatPriceInput(value: number) {
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value);
}

function formatObservedPrice(value: number, currency: string | null) {
  if (!currency || currency === "COP") return formatCop(value);
  return `${currency} ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value)}`;
}

function AirlineLogo({ src, name }: { src?: string | null; name: string }) {
  if (!src || !/^https:\/\//i.test(src)) return null;
  return <img src={src} alt="" aria-label={`${name} logo`} loading="lazy" className="h-6 w-6 shrink-0 rounded object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} />;
}

function runPriceInsight(run: RunWithResults) {
  const prices = run.results.filter((result) => result.amount !== null && Number.isFinite(result.amount));
  if (!prices.length) {
    const emptyDaily: Array<{ result: null; date: string; label: string; destinationIata?: string }> = [];
    const snapshot = run.snapshot;
    if (snapshot && snapshot.mode !== "weekend_escape") {
      const destinations = [...new Set([snapshot.destinationIata, ...(snapshot.destinationIatas ?? [])].filter(Boolean))];
      const axes: Array<{ dates: string[]; label: string }> = [];
      if (snapshot.outboundMode === "flexible") axes.push({ dates: dateRange(snapshot.outboundMode, snapshot.outboundStart, snapshot.outboundEnd), label: "Salida" });
      if (snapshot.tripType === "round_trip" && snapshot.inboundMode === "flexible" && snapshot.inboundStart) axes.push({ dates: dateRange(snapshot.inboundMode, snapshot.inboundStart, snapshot.inboundEnd), label: "Regreso" });
      for (const axis of axes) for (const destinationIata of destinations) for (const date of axis.dates) emptyDaily.push({ result: null, date, label: axis.label, destinationIata });
    }
    const dailySummary = emptyDaily.length ? "Minimos diarios: " + emptyDaily.map(({ date, label, destinationIata }) => label + (destinationIata ? " " + destinationIata : "") + " " + formatDate(date) + " sin lectura").join(" ? ") : "";
    const daily: Array<{ result: typeof prices[number] | null; date: string; label: string; destinationIata?: string }> = emptyDaily;
    if (run.status === "running") return { summary: "Búsqueda en curso", cheapest: null, daily: [], dailySummary: "" };
    if (run.status === "no_prices") return { summary: "No se pudieron leer precios del calendario para las fechas consultadas; esto no confirma que no hubiera vuelos.", cheapest: null, daily, dailySummary };
    return { summary: run.error ? "La busqueda no termino correctamente: " + run.error : statusLabel(run.status), cheapest: null, daily, dailySummary };
  }
  const limit = run.snapshot?.maxPriceCop ?? Number.POSITIVE_INFINITY;
  const withinLimit = prices.filter((result) => result.currency === "COP" && result.amount! <= limit);
  const withMatchingFlights = prices.filter((result) => result.meetsThreshold);
  const cheapest = prices.reduce((best, result) => result.amount! < best.amount! ? result : best);
  const flexibleAxes: Array<{ key: "outboundDate" | "inboundDate"; label: string }> = [];
  if (run.snapshot?.mode === "weekend_escape" || run.snapshot?.outboundMode === "flexible") flexibleAxes.push({ key: "outboundDate", label: "Salida" });
  if (run.snapshot?.mode !== "weekend_escape" && run.snapshot?.tripType === "round_trip" && run.snapshot.inboundMode === "flexible") flexibleAxes.push({ key: "inboundDate", label: "Regreso" });
  const daily: Array<{ result: typeof prices[number] | null; date: string; label: string; destinationIata?: string }> = [];
  for (const axis of flexibleAxes) {
    const byDay = new Map<string, typeof prices[number]>();
    for (const result of prices) {
      const date = result[axis.key];
      if (!date) continue;
      const key = `${result.destinationIata ?? ""}|${date}`;
      const current = byDay.get(key);
      if (!current || result.amount! < current.amount!) byDay.set(key, result);
    }
    const snapshot = run.snapshot!;
    const destinations = [...new Set([...prices.map((result) => result.destinationIata), snapshot.destinationIata, ...(snapshot.destinationIatas ?? [])].filter((value): value is string => Boolean(value)))];
    for (const destinationIata of destinations) {
      const expectedDates = snapshot.mode === "weekend_escape"
        ? [...new Set(prices.filter((result) => result.destinationIata === destinationIata).map((result) => result[axis.key]).filter((value): value is string => Boolean(value)))].sort()
        : axis.key === "outboundDate"
          ? dateRange(snapshot.outboundMode, snapshot.outboundStart, snapshot.outboundEnd)
          : snapshot.inboundStart ? dateRange(snapshot.inboundMode ?? "exact", snapshot.inboundStart, snapshot.inboundEnd) : [];
      for (const date of expectedDates) {
        const result = byDay.get(`${destinationIata}|${date}`) ?? null;
        daily.push({ result, date, label: axis.label, destinationIata });
      }
    }
  }
  daily.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label) || (a.destinationIata ?? "").localeCompare(b.destinationIata ?? ""));
  const dailySummary = daily.length ? `Mínimos diarios: ${daily.map(({ result, date, label, destinationIata }) => `${label}${destinationIata ? ` ${destinationIata}` : ""} ${formatDate(date)} ${result ? formatObservedPrice(result.amount!, result.currency) : "sin lectura"}`).join(" · ")}` : "";
  const minimumText = `Mínimo: ${formatObservedPrice(cheapest.amount!, cheapest.currency)} · ${formatDate(cheapest.outboundDate)}${cheapest.inboundDate ? ` → ${formatDate(cheapest.inboundDate)}` : ""}${cheapest.destinationIata ? ` · ${cheapest.destinationIata}` : ""}.`;
  let summary: string;
  if (!withinLimit.length) summary = `Se leyeron ${prices.length} precios; todos superan el límite de ${formatCop(limit)}. ${minimumText}`;
  else if (!withMatchingFlights.length) summary = `Se leyeron ${prices.length} precios; ${withinLimit.length} están bajo el límite, pero no se encontraron horarios que cumplan las condiciones. ${minimumText}`;
  else {
    const optionCount = withMatchingFlights.reduce((total, result) => total + (result.flightOptions?.length ?? 0), 0);
    summary = `Se leyeron ${prices.length} precios; ${withMatchingFlights.length} resultado(s) cumplen el límite${optionCount ? `, con ${optionCount} opción(es) de vuelo` : ""}. ${minimumText}`;
  }
  return { summary, cheapest, daily, dailySummary };
}

function dateDescription(mode: string, start: string, end: string | null) {
  if (mode === "exact") return formatDate(start, { year: "numeric" });
  return `${formatDate(start)} – ${formatDate(end, { year: "numeric" })}`;
}

function IconButton({ children, onClick, label, className = "" }: { children: React.ReactNode; onClick?: () => void; label: string; className?: string }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`focus-ring inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#62716a] transition hover:bg-[#edf3ee] hover:text-[#147a59] ${className}`}>{children}</button>;
}

function PrimaryButton({ children, onClick, type = "button", disabled, className = "" }: { children: React.ReactNode; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; className?: string }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-[#147a59] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0f6247] ${className}`}>{children}</button>;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="grid gap-1.5 text-sm font-medium text-[#3c4a43]"><span>{label}</span>{children}{hint && <span className="text-xs font-normal text-[#78847d]">{hint}</span>}</label>;
}

const inputClass = "focus-ring h-11 w-full rounded-xl border border-[#dce4dd] bg-white px-3.5 text-sm text-[#1c2a23] outline-none transition placeholder:text-[#a2ada6] focus:border-[#73ad90]";

function PriceSparkline({ values = [42, 39, 44, 32, 35, 26, 29] }: { values?: number[] }) {
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${54 - value}`).join(" ");
  return <svg viewBox="0 0 100 60" className="h-12 w-24 overflow-visible" aria-label="Tendencia visual de precios"><defs><linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#57ae80" stopOpacity=".2"/><stop offset="1" stopColor="#57ae80" stopOpacity="0"/></linearGradient></defs><polygon points={`0,60 ${points} 100,60`} fill="url(#spark-fill)"/><polyline points={points} fill="none" stroke="#18835d" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5"/></svg>;
}

function FollowUpCard({ followUp, onEdit, onToggle, onDelete, onRun, running }: {
  followUp: FollowUp; onEdit: () => void; onToggle: () => void; onDelete: () => void; onRun: () => void; running: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const escape = followUp.mode === "weekend_escape";
  const destinations = followUp.destinationIatas?.length ? followUp.destinationIatas : [followUp.destinationIata];
  const outbound = escape ? `Próximos ${followUp.lookaheadDays ?? 120} días` : dateDescription(followUp.outboundMode, followUp.outboundStart, followUp.outboundEnd);
  const inbound = followUp.tripType === "round_trip" ? dateDescription(followUp.inboundMode ?? "exact", followUp.inboundStart ?? "", followUp.inboundEnd) : null;
  return (
    <article className="card-shadow animate-in rounded-[20px] border border-[#e6ebe5] bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#e8f4ec] text-[#147a59]"><Plane size={19} strokeWidth={1.8}/></span>
          <div className="min-w-0"><h3 className="truncate font-semibold text-[#1b2922]">{followUp.name}</h3><p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#7a867f]"><span className={`h-1.5 w-1.5 rounded-full ${followUp.status === "active" ? "bg-[#37a975]" : "bg-[#aeb7b1]"}`}/>{followUp.status === "active" ? "Activo" : "En pausa"}<span>·</span>{followUp.mode === "weekend_escape" ? "Escape fin de semana" : followUp.tripType === "round_trip" ? "Ida y vuelta" : "Solo ida"}</p></div>
        </div>
        <div className="relative">
          <IconButton label="Más opciones" onClick={() => setMenu(!menu)}><MoreHorizontal size={19}/></IconButton>
          {menu && <><button className="fixed inset-0 z-10 cursor-default" aria-label="Cerrar menú" onClick={() => setMenu(false)}/><div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-[#e5eae5] bg-white p-1.5 shadow-xl">
            <button onClick={() => { setMenu(false); onEdit(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#f4f7f4]"><Settings2 size={15}/> Editar</button>
            <button onClick={() => { setMenu(false); onToggle(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#f4f7f4]">{followUp.status === "active" ? <Pause size={15}/> : <Play size={15}/>} {followUp.status === "active" ? "Pausar" : "Activar"}</button>
            <button onClick={() => { setMenu(false); onRun(); }} disabled={running} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#f4f7f4] disabled:opacity-40"><RefreshCw size={15}/> Ejecutar ahora</button>
            <div className="my-1 border-t border-[#edf0ed]"/><button onClick={() => { setMenu(false); onDelete(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[#b94d45] hover:bg-[#fbf1f0]"><Trash2 size={15}/> Eliminar</button>
          </div></>}
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#f7f9f6] px-3.5 py-3">
        <span className="max-w-[25%] truncate text-sm font-semibold text-[#2e3b34]">{followUp.originIata}</span><ArrowRight size={15} className="shrink-0 text-[#91a098]"/><span className="max-w-[55%] truncate text-sm font-semibold text-[#2e3b34]">{destinations.join(", ")}</span><span className="ml-auto flex items-center gap-1 text-xs text-[#68766e]"><MapPin size={13}/> Aeropuertos</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#748179]">{escape ? "Horarios de salida" : "Salida"}</p><p className="mt-1 text-sm text-[#39473f]">{escape ? "Viernes noche o sábado mañana" : outbound}</p></div>
        {escape ? <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#748179]">Regreso</p><p className="mt-1 text-sm text-[#39473f]">Domingo o lunes festivo · 4–8 p. m.</p></div> : inbound && <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#748179]">Regreso</p><p className="mt-1 text-sm text-[#39473f]">{inbound}</p></div>}
        <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#748179]">Pasajeros</p><p className="mt-1 text-sm text-[#39473f]">{followUp.adults} adulto{followUp.adults === 1 ? "" : "s"}</p></div>
        <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#748179]">Avisar hasta</p><p className="mt-1 text-sm font-semibold text-[#147a59]">{formatCop(followUp.maxPriceCop)}</p></div>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-[#edf0ed] pt-4"><span className="inline-flex items-center gap-1.5 text-xs text-[#79867f]"><Clock3 size={13}/> Próxima revisión diaria</span><button onClick={onEdit} className="inline-flex items-center gap-1 text-xs font-semibold text-[#147a59] hover:text-[#0f6247]">Ver detalle <ArrowRight size={13}/></button></div>
    </article>
  );
}

function FollowUpModal({ initial, onClose, onSave }: { initial: FollowUp | null; onClose: () => void; onSave: (data: FollowUpInput, id?: string) => Promise<void> }) {
  const [form, setForm] = useState<FollowUpInput>(() => initial ? {
    name: initial.name, originIata: initial.originIata, destinationIata: initial.destinationIata, destinationIatas: initial.destinationIatas ?? [initial.destinationIata],
    mode: initial.mode ?? "standard", lookaheadDays: initial.lookaheadDays ?? 120, minNoticeHours: initial.minNoticeHours ?? 8,
    tripType: initial.tripType, outboundMode: initial.outboundMode, outboundStart: initial.outboundStart,
    outboundEnd: initial.outboundEnd, inboundMode: initial.inboundMode ?? "exact", inboundStart: initial.inboundStart,
    inboundEnd: initial.inboundEnd, stayNights: initial.stayNights, adults: initial.adults,
    maxPriceCop: initial.maxPriceCop, status: initial.status,
  } : emptyForm());
  const [priceFocused, setPriceFocused] = useState(false);
  const [priceDraft, setPriceDraft] = useState(() => String(initial?.maxPriceCop ?? 500000));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof FollowUpInput, value: unknown) => setForm((old) => ({ ...old, [key]: value }));
  const weekendDestinations = form.destinationIatas?.length ? form.destinationIatas : [""];
  function updateWeekendDestination(index: number, code: string) {
    setForm((old) => {
      const destinations = old.destinationIatas?.length ? [...old.destinationIatas] : [""];
      destinations[index] = code;
      return { ...old, destinationIatas: destinations, destinationIata: destinations[0] ?? "" };
    });
  }
  function addWeekendDestination() {
    setForm((old) => {
      const destinations = old.destinationIatas?.length ? [...old.destinationIatas] : [""];
      destinations.push("");
      return { ...old, destinationIatas: destinations };
    });
  }
  function removeWeekendDestination(index: number) {
    setForm((old) => {
      const destinations = (old.destinationIatas?.length ? old.destinationIatas : [""]).filter((_, itemIndex) => itemIndex !== index);
      return { ...old, destinationIatas: destinations, destinationIata: destinations[0] ?? "" };
    });
  }
  const dateInput = "focus-ring h-11 w-full rounded-xl border border-[#dce4dd] bg-white px-3 text-sm text-[#26342c] outline-none focus:border-[#73ad90]";
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const selectedWeekendDestinations = (form.destinationIatas ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean);
    const payload: FollowUpInput = {
      ...form,
      originIata: form.originIata.toUpperCase(),
      destinationIata: (form.mode === "weekend_escape" ? selectedWeekendDestinations[0] : form.destinationIata)?.toUpperCase() ?? "",
      destinationIatas: form.mode === "weekend_escape" ? selectedWeekendDestinations : [form.destinationIata.toUpperCase()],
      outboundStart: form.mode === "weekend_escape" ? form.outboundStart || tomorrowBogota() : form.outboundStart,
      outboundEnd: form.outboundMode === "flexible" ? form.outboundEnd || null : null,
      inboundMode: form.tripType === "round_trip" ? form.inboundMode ?? "exact" : null,
      inboundStart: form.tripType === "round_trip" ? form.inboundStart || (form.mode === "weekend_escape" ? addIsoDays(tomorrowBogota(), 1) : null) : null,
      inboundEnd: form.tripType === "round_trip" && form.inboundMode === "flexible" ? form.inboundEnd || null : null,
      stayNights: form.tripType === "round_trip" ? form.stayNights : null,
    };
    try { await onSave(payload, initial?.id); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#14231c]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form onSubmit={submit} className="animate-in flex max-h-[94vh] w-full max-w-[680px] flex-col overflow-hidden rounded-t-[24px] border border-[#e5ebe5] bg-white shadow-2xl sm:rounded-[24px]">
      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
      <div className="flex items-start justify-between"><div><span className="text-xs font-semibold uppercase tracking-[.12em] text-[#26805d]">{initial ? "Editar seguimiento" : "Nuevo seguimiento"}</span><h2 className="mt-1 text-2xl font-semibold tracking-[-.04em] text-[#1b2922]">Configuremos tu alerta</h2></div><IconButton label="Cerrar" onClick={onClose}><X size={19}/></IconButton></div>
      <div className="mt-6 space-y-5">
      <section className="space-y-3">
        <div><h3 className="text-sm font-semibold text-[#314138]">Datos y ruta</h3><p className="mt-0.5 text-xs text-[#68766e]">Define el seguimiento, los aeropuertos y los pasajeros.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Nombre del seguimiento"><input className={inputClass} value={form.name} placeholder="Ej. Vacaciones de mitad de año" onChange={(e) => update("name", e.target.value)} required maxLength={80}/></Field></div>
          <Field label="Tipo de seguimiento"><select className={inputClass} value={form.mode ?? "standard"} onChange={(e) => update("mode", e.target.value)}><option value="standard">Fechas configuradas</option><option value="weekend_escape">Escape fin de semana</option></select></Field>
          {form.mode !== "weekend_escape" && <Field label="Tipo de viaje"><select className={inputClass} value={form.tripType} onChange={(e) => update("tripType", e.target.value)}><option value="round_trip">Ida y vuelta</option><option value="one_way">Solo ida</option></select></Field>}
          <Field label="Origen" hint="Busca por ciudad, nombre del aeropuerto o código IATA y selecciona una coincidencia."><AirportAutocomplete ariaLabel="Origen" value={form.originIata} placeholder="Ej. Bogotá o BOG" onChange={(code) => update("originIata", code)}/></Field>
          {form.mode === "weekend_escape" ? <div className="sm:col-span-2"><div className="grid gap-1.5 text-sm font-medium text-[#3c4a43]"><span>Destinos</span><span className="text-xs font-normal text-[#65736b]">Añade uno o más aeropuertos; busca por nombre o código IATA.</span><div className="grid gap-3 sm:grid-cols-2">{weekendDestinations.map((code, index) => <div key={`escape-destination-${index}`} className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1"><AirportAutocomplete ariaLabel={`Destino ${index + 1}`} value={code} placeholder={`Destino ${index + 1}: nombre o código`} onChange={(nextCode) => updateWeekendDestination(index, nextCode)}/></div>{weekendDestinations.length > 1 && <IconButton label={`Quitar destino ${index + 1}`} onClick={() => removeWeekendDestination(index)}><X size={15}/></IconButton>}</div>)}</div><div className="flex items-center justify-between gap-3"><span className="text-xs font-normal text-[#65736b]">{weekendDestinations.filter(Boolean).length} destino(s) configurado(s)</span><button type="button" onClick={addWeekendDestination} className="flex h-10 items-center gap-1.5 rounded-xl border border-dashed border-[#cbd9ce] px-3 text-xs font-semibold text-[#217c59] hover:bg-[#f4f8f3]"><Plus size={14}/> Añadir destino</button></div></div></div> : <Field label="Destino" hint="Busca por ciudad, nombre del aeropuerto o código IATA y selecciona una coincidencia."><AirportAutocomplete ariaLabel="Destino" value={form.destinationIata} placeholder="Ej. Cali o CLO" onChange={(code) => update("destinationIata", code)}/></Field>}
          <Field label="Adultos" hint="Debe viajar al menos un adulto."><div className="flex h-11 items-center justify-between rounded-xl border border-[#dce4dd] px-3 sm:max-w-[300px]"><button type="button" onClick={() => update("adults", Math.max(1, form.adults - 1))} className="rounded-lg p-1.5 text-[#64736b] hover:bg-[#f1f5f1]"><Minus size={15}/></button><span className="text-sm font-semibold">{form.adults}</span><button type="button" onClick={() => update("adults", Math.min(9, form.adults + 1))} className="rounded-lg p-1.5 text-[#147a59] hover:bg-[#eaf4ed]"><Plus size={15}/></button></div></Field>
        </div>
      </section>

      <section className="space-y-3 border-t border-[#e8ede8] pt-4">
        <div><h3 className="text-sm font-semibold text-[#314138]">{form.mode === "weekend_escape" ? "Plan de escape" : "Fechas del viaje"}</h3><p className="mt-0.5 text-xs text-[#68766e]">{form.mode === "weekend_escape" ? "Configura el horizonte y la anticipación mínima." : "La ida y el regreso se organizan juntos; elige días exactos o rangos flexibles."}</p></div>
        {form.mode === "weekend_escape" ? <><div className="grid gap-4 sm:grid-cols-2"><Field label="Días límite de búsqueda" hint="Desde hoy en Bogotá. Valor inicial: 120 días."><input className={inputClass} type="number" min={1} max={365} value={form.lookaheadDays ?? 120} onChange={(e) => update("lookaheadDays", Number(e.target.value))} required/></Field><Field label="Anticipación mínima del vuelo" hint="Se omiten vuelos que salgan antes de cumplir este mínimo."><div className="relative"><input className={`${inputClass} pr-16`} type="number" min={1} max={168} value={form.minNoticeHours ?? 8} onChange={(e) => update("minNoticeHours", Number(e.target.value))} required/><span className="absolute right-3 top-3 text-xs text-[#89958e]">horas</span></div></Field></div><div className="rounded-xl bg-[#f5f8f5] p-3 text-xs leading-5 text-[#65736b]">Viernes 7:00–10:00 p. m. o sábado 6:00–10:00 a. m.; regreso domingo 4:00–8:00 p. m. y también lunes en ese horario si es festivo nacional.</div></> : <div className="grid gap-4 sm:grid-cols-2"><DateSection label="Salida" mode={form.outboundMode} start={form.outboundStart} end={form.outboundEnd ?? ""} onMode={(value) => update("outboundMode", value)} onStart={(value) => update("outboundStart", value)} onEnd={(value) => update("outboundEnd", value)} required/>{form.tripType === "round_trip" && <DateSection label="Regreso" mode={form.inboundMode ?? "exact"} start={form.inboundStart ?? ""} end={form.inboundEnd ?? ""} minDate={form.outboundStart} separated onMode={(value) => update("inboundMode", value)} onStart={(value) => update("inboundStart", value)} onEnd={(value) => update("inboundEnd", value)} required/>}{form.tripType === "round_trip" && (form.outboundMode === "flexible" || form.inboundMode === "flexible") && <div className="sm:col-span-2"><Field label="Duración de estadía" hint="Opcional. Si la dejas vacía, se consideran combinaciones válidas de al menos una noche."><div className="relative"><input className={`${inputClass} pr-20`} type="number" min={1} max={365} value={form.stayNights ?? ""} placeholder="Cualquier duración" onChange={(e) => update("stayNights", e.target.value ? Number(e.target.value) : null)}/><span className="absolute right-3 top-3 text-xs text-[#89958e]">noches</span></div></Field></div>}</div>}
      </section>

      <section className="space-y-3 border-t border-[#e8ede8] pt-4">
        <div><h3 className="text-sm font-semibold text-[#314138]">Precio de alerta</h3><p className="mt-0.5 text-xs text-[#68766e]">Recibirás un correo si el precio total es igual o inferior al límite.</p></div>
        <Field label="Precio máximo total · COP"><div className="relative"><span className="absolute left-3.5 top-3 text-sm text-[#65736b]">$</span><input className={`${inputClass} pl-8 pr-16`} type="text" inputMode="numeric" aria-label="Precio máximo total en pesos colombianos" value={priceFocused ? priceDraft : formatPriceInput(form.maxPriceCop)} onFocus={(event) => { const input = event.currentTarget; setPriceDraft(String(form.maxPriceCop)); setPriceFocused(true); window.requestAnimationFrame(() => { if (document.activeElement === input) input.select(); }); }} onChange={(e) => { const digits = e.target.value.replace(/\D/g, ""); setPriceDraft(e.target.value); update("maxPriceCop", digits ? Number(digits) : 0); }} onBlur={() => { setPriceFocused(false); setPriceDraft(String(form.maxPriceCop)); }} required/><span className="absolute right-3.5 top-3 text-xs font-medium text-[#65736b]">COP</span></div></Field>
      </section>
    </div>
      {error && <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#fff2ef] px-3.5 py-3 text-sm text-[#ac433c]"><CircleAlert size={17} className="mt-0.5 shrink-0"/>{error}</p>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-[#edf0ed] bg-white px-5 py-4 sm:px-7"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-[#617067] hover:bg-[#f3f6f3]">Cancelar</button><PrimaryButton type="submit" disabled={saving}>{saving ? "Guardando…" : initial ? "Guardar cambios" : "Crear seguimiento"}<ArrowRight size={16}/></PrimaryButton></div>
    </form>
  </div>;
}

function DateSection({ label, mode, start, end, onMode, onStart, onEnd, required, minDate, separated }: { label: string; mode: "exact" | "flexible"; start: string; end: string; onMode: (mode: "exact" | "flexible") => void; onStart: (date: string) => void; onEnd: (date: string) => void; required?: boolean; minDate?: string; separated?: boolean }) {
  const endDateRef = useRef<HTMLInputElement>(null);
  function chooseStart(date: string) {
    onStart(date);
    if (end && date && end < date) onEnd("");
    if (mode !== "flexible" || !date) return;
    window.requestAnimationFrame(() => {
      const endDate = endDateRef.current;
      if (!endDate) return;
      endDate.focus();
      try { endDate.showPicker(); } catch { /* Focus still moves to the end-date field when the browser blocks opening the picker. */ }
    });
  }
  return <div className={`grid gap-1.5 text-sm font-medium text-[#3c4a43] ${separated ? "border-t border-[#e1e8e2] pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0" : ""}`}><span>{label} {required && <span className="text-[#b94d45">*</span>}</span><div className="grid grid-cols-2 gap-2"><select aria-label={`${label}: tipo de fecha`} className={`${inputClass} min-w-0 px-2.5`} value={mode} onChange={(event) => onMode(event.target.value as "exact" | "flexible")}><option value="exact">Día exacto</option><option value="flexible">Rango flexible</option></select><input aria-label={`${label}: fecha inicial`} className={`${inputClass} min-w-0 px-2.5`} type="date" min={minDate} value={start} onChange={(event) => chooseStart(event.target.value)} required/>{mode === "flexible" && <><span aria-hidden="true"/><input ref={endDateRef} aria-label={`${label}: fecha final`} className={`${inputClass} min-w-0 px-2.5`} type="date" min={start || minDate} value={end} onChange={(event) => { const value = event.target.value; if (!value || value >= (start || minDate || "")) onEnd(value); }} required/></>}</div></div>;
}

function HistoryRow({ run, onStop, progress }: { run: RunWithResults; onStop: (run: RunWithResults) => Promise<void>; progress?: RunnerProgress | null }) {
  const [expanded, setExpanded] = useState(false);
  const [stopping, setStopping] = useState(false);
  const matches = run.results.filter((result) => result.meetsThreshold);
  const insight = runPriceInsight(run);
  const snapshot = run.snapshot;
  const hasDetails = Boolean(snapshot) || run.results.length > 0 || Boolean(run.scheduledAt) || Boolean(run.notificationRecipient) || Boolean(run.notificationError);
  return <article className="grid gap-3 border-b border-[#edf0ed] py-4 last:border-0 xl:grid-cols-[minmax(0,1.6fr)_minmax(180px,.9fr)_minmax(160px,.8fr)_minmax(140px,.65fr)] xl:items-center">
    <div className="flex min-w-0 gap-3"><span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${run.status === "failed" ? "bg-[#fff0ed] text-[#b94d45]" : matches.length ? "bg-[#e7f4ec] text-[#18825c]" : "bg-[#f0f3ef] text-[#78847e]"}`}>{run.status === "failed" ? <CircleAlert size={17}/> : matches.length ? <TrendingDown size={17}/> : <Plane size={16}/>}</span><div className="min-w-0"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#829087] xl:hidden">Seguimiento</p><p className="truncate text-sm font-semibold text-[#27352e]">{run.followUpName}</p>{run.status === "running" ? <div className="mt-2 max-w-lg rounded-lg border border-[#e8eee8] bg-[#fafcf9] px-3 py-2"><div className="flex items-center justify-between gap-3 text-[11px]"><span className="truncate font-semibold text-[#35453b]">{progress?.phase ?? "Preparando consulta"}</span><span className="shrink-0 tabular-nums font-semibold text-[#217c59]">{progress ? `${progress.completed}/${progress.total}` : "Iniciando"}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e9efea]"><div className="h-full rounded-full bg-[#21845e] transition-[width] duration-300" style={{ width: `${progress?.total ? Math.min(100, progress.completed / progress.total * 100) : 4}%` }}/></div>{progress?.current && <p className="mt-1 truncate text-[10px] text-[#849088]" title={progress.current}>{progress.current}</p>}</div> : <p className="mt-1 text-xs leading-5 text-[#69776f]">{insight.summary}</p>}{run.status === "running" && snapshot?.mode === "weekend_escape" && progress?.destinationProgress?.length ? <div className="mt-2 rounded-lg border border-[#e8eee8] bg-[#fafcf9] p-2.5"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[#718077]">Combinaciones del calendario por destino</p><p className="mb-2 text-[10px] leading-4 text-[#849088]">Al terminar el calendario, se consultan los horarios de los precios que cumplen el límite.</p><div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">{progress.destinationProgress.map((item) => <div key={item.destinationIata} className="min-w-0"><div className="mb-1 flex items-center justify-between gap-2 text-[11px]"><span className="font-semibold text-[#35453b]">{item.destinationIata}</span><span className="tabular-nums text-[#718077]">{item.completed}/{item.total}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#e9efea]"><div className="h-full rounded-full bg-[#21845e] transition-[width] duration-300" style={{ width: `${item.total ? Math.min(100, item.completed / item.total * 100) : 0}%` }}/></div></div>)}</div><p className="mt-2 text-[10px] text-[#849088]">Total del seguimiento: {progress.destinationProgress.reduce((sum, item) => sum + item.completed, 0)}/{progress.destinationProgress.reduce((sum, item) => sum + item.total, 0)} combinaciones del calendario</p>{progress.phase === "Buscando horarios" ? <div className="mt-3 border-t border-[#e8eee8] pt-2"><div className="mb-1 flex items-center justify-between text-[11px]"><span className="font-semibold text-[#35453b]">Horarios consultados</span><span className="tabular-nums font-semibold text-[#217c59]">{progress.completed}/{progress.total}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#e9efea]"><div className="h-full rounded-full bg-[#21845e] transition-[width] duration-300" style={{ width: `${progress.total ? Math.min(100, progress.completed / progress.total * 100) : 100}%` }}/></div>{progress.current && <p className="mt-1 text-[10px] text-[#849088]">Actual: {progress.current}</p>}</div> : null}</div> : null}</div></div>
    <div className="text-xs text-[#728078]"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#829087] xl:hidden">Fecha de ejecución</p><div className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2 gap-y-1"><span className="font-medium text-[#536259]">Inicio</span><time className="tabular-nums">{formatDateTime(run.startedAt)}</time><span className="font-medium text-[#536259]">Fin</span><span className="tabular-nums">{run.finishedAt ? formatDateTime(run.finishedAt) : run.status === "running" ? `En curso · ${formatElapsed(run.startedAt)}` : "—"}</span><span className="font-medium text-[#536259]">Total</span><span className="tabular-nums">{run.finishedAt ? formatProcessingDuration(run.startedAt, run.finishedAt) : run.status === "running" ? formatProcessingDuration(run.startedAt) : "—"}</span></div><p className="mt-1 text-[11px] text-[#98a29b]">{run.runType === "scheduled" ? "Programada" : "Manual"}</p></div>
    <div className="flex items-center justify-between gap-3 xl:justify-start"><div><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#829087] xl:hidden">Estado</p><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${run.notificationStatus === "sent" ? "bg-[#e6f4eb] text-[#177a55]" : run.status === "failed" || run.notificationStatus === "failed" ? "bg-[#fff0ed] text-[#b94d45]" : "bg-[#f1f4f1] text-[#728078]"}`}>{run.notificationStatus === "sent" ? "Correo enviado" : run.notificationStatus === "failed" ? "Correo fallido" : run.notificationStatus === "not_configured" ? "Correo sin configurar" : statusLabel(run.status)}</span>{run.status === "running" && <button type="button" disabled={stopping} onClick={async () => { setStopping(true); await onStop(run); setStopping(false); }} aria-label={`Detener ejecución de ${run.followUpName}`} title="Detener ejecución" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#f0d0cc] bg-white px-2.5 text-xs font-semibold text-[#b5463e] hover:bg-[#fff5f3] disabled:opacity-60"><Square size={13} fill="currentColor"/> {stopping ? "Deteniendo…" : "Detener"}</button>}</div></div></div><div className="text-sm font-semibold text-[#29372f]"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#829087] xl:hidden">Precio mínimo encontrado</p>{insight.cheapest?.amount != null ? formatObservedPrice(insight.cheapest.amount, insight.cheapest.currency) : run.status === "running" ? "Pendiente" : "Sin precio leído"}</div>
    {hasDetails && <div className="xl:col-span-4"><button type="button" onClick={() => setExpanded((value) => !value)} className="text-xs font-semibold text-[#217c59]">{expanded ? "Ocultar detalles" : "Ver detalles"}</button>{expanded && <div className="mt-2 space-y-2 rounded-xl bg-[#f7f9f6] p-3">
      {snapshot && <div className="text-xs leading-5 text-[#58675e]"><p className="font-semibold">{snapshot.originIata} → {(snapshot.destinationIatas ?? [snapshot.destinationIata]).join(", ")} · {snapshot.mode === "weekend_escape" ? "Escape fin de semana" : snapshot.tripType === "round_trip" ? "Ida y vuelta" : "Solo ida"}</p>{snapshot.mode === "weekend_escape" ? <p>Horizonte: {snapshot.lookaheadDays ?? 120} días · anticipación mínima: {snapshot.minNoticeHours ?? 8} h</p> : <><p>Salida: {dateDescription(snapshot.outboundMode, snapshot.outboundStart, snapshot.outboundEnd)}</p>{snapshot.tripType === "round_trip" && snapshot.inboundMode && snapshot.inboundStart && <p>Regreso: {dateDescription(snapshot.inboundMode, snapshot.inboundStart, snapshot.inboundEnd)}</p>}</>}<p>{snapshot.adults} adulto(s) · límite {formatCop(snapshot.maxPriceCop)} · {snapshot.status === "active" ? "seguimiento activo" : "seguimiento en pausa"}</p></div>}
      {run.scheduledAt && <p className="text-[11px] text-[#68766e]">Hora programada: {formatDateTime(run.scheduledAt)} (Bogotá)</p>}
      {(run.notificationRecipient || run.notificationSentAt || run.notificationError) && <p className="text-xs text-[#58675e]">Correo: {run.notificationRecipient || "destinatario sin configurar"}{run.notificationSentAt ? ` · enviado ${formatDateTime(run.notificationSentAt)}` : ""}{run.notificationError ? ` · ${run.notificationError}` : ""}</p>}
      
      {insight.daily.length > 0 && <section className="rounded-lg border border-[#e5ebe5] bg-white p-3"><p className="text-xs font-semibold text-[#35453b]">Precios mínimos por día</p><div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">{insight.daily.map(({ result, date, label, destinationIata }, index) => <p key={`${label}-${destinationIata}-${date}-${index}`} className="text-xs text-[#58675e]">{label} {formatDate(date)} → <span className="font-semibold">{result ? formatObservedPrice(result.amount!, result.currency) : "sin lectura"}</span>{label === "Salida" && result && result.inboundDate ? <span> (regreso {formatDate(result.inboundDate)})</span> : null}</p>)}</div><p className="mt-2 text-[11px] text-[#839087]">Cada valor es el menor precio leído entre las combinaciones consultadas que incluyen ese día.</p></section>}
      {run.results.map((result, index) => <div key={`${result.outboundDate}-${result.inboundDate}-${index}`} className="space-y-1 text-xs text-[#58675e]"><p>{result.destinationIata && <span className="font-semibold">{snapshot?.originIata} → {result.destinationIata} · </span>}<span className="font-semibold">{result.outboundDate}{result.inboundDate ? ` → ${result.inboundDate}` : ""}</span>{result.amount != null && <> · {formatObservedPrice(result.amount, result.currency)}</>}{result.meetsThreshold ? " · Cumple el límite" : ""}{result.details && <> · {result.details}</>}{result.observedText && <> · {result.observedText}</>}</p>{result.flightDetailsStatus === "unavailable" && <p className="text-[#9b6a17]">No se pudo cargar el detalle de horarios; se conserva el precio del calendario.</p>}{result.flightDetailsStatus === "no_matching_flights" && <p className="text-[#78847e]">No hubo opciones que cumplieran el horario y la anticipación mínima.</p>}{result.flightOptions?.map((option, optionIndex) => <p key={optionIndex} className="flex flex-wrap items-center gap-1.5 pl-3"><span className="inline-flex items-center gap-1.5"><AirlineLogo src={option.outboundLogoUrl} name={option.outboundAirline}/>{option.outboundAirline}</span>{option.inboundAirline && option.inboundAirline !== option.outboundAirline && <span className="inline-flex items-center gap-1.5">ida / <AirlineLogo src={option.inboundLogoUrl} name={option.inboundAirline}/>{option.inboundAirline} regreso</span>}<span>· Ida {option.outboundDepartureTime}–{option.outboundArrivalTime}{option.inboundDepartureTime && option.inboundArrivalTime ? ` · Regreso ${option.inboundDepartureTime}–${option.inboundArrivalTime}` : ""} · {formatObservedPrice(option.amount, option.currency)}{option.separateTickets ? " · Boletos separados" : ""}</span></p>)}</div>)}
    </div>}</div>}
  </article>;
}
function statusLabel(status: string) {
  const map: Record<string, string> = { completed: "Revisión lista", completed_with_matches: "Con coincidencias", no_prices: "No se pudo leer precio", failed: "Consulta fallida", cancelled: "Detenida", skipped_overlap: "Horario omitido", running: "En curso" };
  return map[status] ?? status;
}

export default function Home() {
  const [page, setPage] = useState<PageKey>("overview");
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [runs, setRuns] = useState<RunWithResults[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticLog[]>([]);
  const [diagnosticsLimit, setDiagnosticsLimit] = useState(200);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [vault, setVault] = useState<VaultState>({ configured: false, unlocked: false });
  const [runner, setRunner] = useState<RunnerViewState>({ running: false, currentLabel: null, currentRunId: null, startedAt: null, progress: null });
  const [modal, setModal] = useState<FollowUp | null | false>(false);
  const [toast, setToast] = useState("");
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction>("idle");
  const [busy, setBusy] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [vaultKey, setVaultKey] = useState("");
  const [rememberVaultKey, setRememberVaultKey] = useState(false);
  const rememberedPreferenceLoaded = useRef(false);
  const vaultKeyInputRef = useRef<HTMLInputElement>(null);
  const focusVaultKeyOnSettings = useRef(false);
  const [showVaultKey, setShowVaultKey] = useState(false);
  const [emailJsConfig, setEmailJsConfig] = useState<EmailJsCredentials>({ serviceId: "", templateId: "", publicKey: "", privateKey: "" });
  const [emailJsConfigured, setEmailJsConfigured] = useState(false);
  const [emailJsPrivateKeyConfigured, setEmailJsPrivateKeyConfigured] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingEmailJs, setSavingEmailJs] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [query, setQuery] = useState("");
  const [historyFollowUpId, setHistoryFollowUpId] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [bogotaClock, setBogotaClock] = useState<string | null>(null);

  const refresh = useCallback(async (options?: { preserveSettingsDraft?: boolean; quiet?: boolean }) => {
    try {
      const [followData, historyData, settingsData, runnerData, diagnosticData, emailJsData] = await Promise.all([
        requestJson<{ followUps: FollowUp[] }>("/api/follow-ups"),
        requestJson<{ runs: RunWithResults[] }>("/api/history"),
        requestJson<{ settings: AppSettings; vault: VaultState; unlocked: boolean }>("/api/settings"),
        requestJson<typeof runner>("/api/runner"),
        requestJson<{ logs: DiagnosticLog[] }>(`/api/diagnostics?limit=${diagnosticsLimit}`),
        requestJson<{ config: EmailJsCredentials; configured: boolean; privateKeyConfigured: boolean }>("/api/emailjs"),
      ]);
      setFollowUps(followData.followUps); setRuns(historyData.runs);
      // The periodic poll must not replace text the user is currently editing.
      if (!options?.preserveSettingsDraft) setSettings(settingsData.settings);
      if (!options?.preserveSettingsDraft) {
        setEmailJsConfig(emailJsData.config);
        setEmailJsConfigured(emailJsData.configured);
        setEmailJsPrivateKeyConfigured(emailJsData.privateKeyConfigured);
      }
      setVault({ ...settingsData.vault, unlocked: settingsData.unlocked }); if (!rememberedPreferenceLoaded.current) { setRememberVaultKey(Boolean(settingsData.vault.remembered)); rememberedPreferenceLoaded.current = true; } setRunner(runnerData); setDiagnostics(diagnosticData.logs);
      return true;
    } catch (error) { if (!options?.quiet) setToast(error instanceof Error ? error.message : "No se pudo cargar la app."); return false; }
  }, [diagnosticsLimit]);

  useEffect(() => {
    const pendingRestart = sessionStorage.getItem(restartSessionKey) === "1";
    if (pendingRestart) {
      setLifecycleAction("restarting");
      void (async () => {
        for (let attempt = 0; attempt < 40; attempt++) {
          if (await refresh({ quiet: true })) {
            sessionStorage.removeItem(restartSessionKey);
            setLifecycleAction("idle"); setToast("Aplicación reiniciada y datos cargados.");
            return;
          }
          await delay(500);
        }
        setLifecycleAction("idle"); setToast("La aplicación reinició, pero no se pudieron cargar todos los datos. Recarga la página.");
      })();
    } else void refresh();
    const timer = window.setInterval(() => void refresh({ preserveSettingsDraft: true }), 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const pollRunner = () => { void requestJson<RunnerViewState>("/api/runner").then(setRunner).catch(() => undefined); };
    const timer = window.setInterval(pollRunner, 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const updateClock = () => setBogotaClock(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()));
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("vuela-lifecycle");
    channel.onmessage = (event: MessageEvent<"stop" | "reload">) => {
      if (event.data === "stop") closeCurrentTab();
      if (event.data === "reload") { sessionStorage.setItem(restartSessionKey, "1"); window.location.reload(); }
    };
    return () => channel.close();
  }, []);
  useEffect(() => {
    if (page !== "settings" || !focusVaultKeyOnSettings.current) return;
    focusVaultKeyOnSettings.current = false;
    const frame = window.requestAnimationFrame(() => {
      const input = vaultKeyInputRef.current;
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      input?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [page]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 4200); return () => window.clearTimeout(timer); }, [toast]);

  const activeCount = followUps.filter((item) => item.status === "active").length;
  const matchRuns = runs.filter((run) => run.results.some((result) => result.meetsThreshold));
  const filteredFollowUps = useMemo(() => followUps.filter((item) => `${item.name} ${item.originIata} ${(item.destinationIatas ?? [item.destinationIata]).join(" ")}`.toLowerCase().includes(query.toLowerCase())), [followUps, query]);
  const historyFollowUps = useMemo(() => [...new Map(runs.map((run) => [run.followUpId, run.followUpName])).entries()], [runs]);
  const filteredRuns = useMemo(() => runs.filter((run) => {
    if (historyFollowUpId && run.followUpId !== historyFollowUpId) return false;
    const date = bogotaDateKey(run.startedAt);
    if (historyFrom && date < historyFrom) return false;
    if (historyTo && date > historyTo) return false;
    return true;
  }), [runs, historyFollowUpId, historyFrom, historyTo]);

  async function saveFollowUp(data: FollowUpInput, id?: string) {
    await requestJson("/api/follow-ups", { method: "POST", body: JSON.stringify({ ...data, id }) });
    await refresh(); setToast(id ? "Seguimiento actualizado." : "Seguimiento creado.");
  }
  async function toggleStatus(item: FollowUp) {
    await requestJson("/api/follow-ups/status", { method: "POST", body: JSON.stringify({ id: item.id, status: item.status === "active" ? "paused" : "active" }) });
    await refresh(); setToast(item.status === "active" ? "Seguimiento pausado." : "Seguimiento activado.");
  }
  async function deleteItem(item: FollowUp) {
    if (!window.confirm(`¿Eliminar el seguimiento “${item.name}”? El historial existente se conservará.`)) return;
    await requestJson("/api/follow-ups", { method: "POST", body: JSON.stringify({ action: "delete", id: item.id }) });
    await refresh(); setToast("Seguimiento eliminado.");
  }
  async function runNow(id?: string) {
    setBusy(true);
    try { await requestJson("/api/runner", { method: "POST", body: JSON.stringify({ followUpId: id }) }); setToast(id ? "Consulta iniciada." : "Consultas iniciadas."); await refresh(); }
    catch (error) { setToast(error instanceof Error ? error.message : "No se pudo iniciar."); }
    finally { setBusy(false); }
  }
  async function stopExecution(run: RunWithResults) {
    if (!window.confirm(`¿Detener la ejecución de “${run.followUpName}”?`)) return;
    try {
      await requestJson("/api/runner", { method: "POST", body: JSON.stringify({ action: "stop", runId: run.id }) });
      await refresh(); setToast(`Ejecución detenida: ${run.followUpName}.`);
    } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo detener la ejecución."); await refresh({ quiet: true }); }
  }
  async function clearAllHistory() {
    if (!runs.length || !window.confirm("Se borrarán permanentemente todas las ejecuciones, precios y avisos del historial. Tus seguimientos y configuración se conservarán. ¿Continuar?")) return;
    setClearingHistory(true);
    try {
      const response = await requestJson<{ deletedRuns: number }>("/api/history", { method: "DELETE" });
      await refresh(); setToast(`Historial borrado (${response.deletedRuns} ejecuciones).`);
    } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo borrar el historial."); }
    finally { setClearingHistory(false); }
  }
  async function saveAppSettings(event: React.FormEvent) {
    event.preventDefault(); setSavingSettings(true); setSettingsSaved(false);
    try {
      const response = await requestJson<{ settings: AppSettings; vault: VaultState; unlocked: boolean }>("/api/settings", { method: "POST", body: JSON.stringify(settings) });
      setSettings(response.settings); setVault({ ...response.vault, unlocked: response.unlocked }); setSettingsSaved(true); setToast("Configuración guardada.");
    } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo guardar la configuración."); }
    finally { setSavingSettings(false); }
  }
  async function saveEmailJsSettings(event: React.FormEvent) {
    event.preventDefault(); setSavingEmailJs(true);
    try {
      const response = await requestJson<{ config: EmailJsCredentials; configured: boolean; privateKeyConfigured: boolean }>("/api/emailjs", { method: "POST", body: JSON.stringify(emailJsConfig) });
      setEmailJsConfig(response.config); setEmailJsConfigured(response.configured); setEmailJsPrivateKeyConfigured(response.privateKeyConfigured); setToast("Configuración de EmailJS guardada en la bóveda.");
    } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo guardar EmailJS."); }
    finally { setSavingEmailJs(false); }
  }
  async function vaultAction(action: "setup" | "unlock" | "lock") {
    try {
      const response = await requestJson<VaultState>("/api/vault", { method: "POST", body: JSON.stringify({ action, passphrase: vaultKey, remember: rememberVaultKey }) });
      setVault(response); setVaultKey(""); setRememberVaultKey(Boolean(response.remembered)); rememberedPreferenceLoaded.current = true; setToast(action === "lock" ? "Bóveda bloqueada." : "Bóveda desbloqueada."); await refresh();
    } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo abrir la bóveda."); }
  }
  async function toggleRememberVaultKey(remember: boolean) {
    setRememberVaultKey(remember); rememberedPreferenceLoaded.current = true;
    if (!remember) {
      try {
        const response = await requestJson<VaultState>("/api/vault", { method: "POST", body: JSON.stringify({ action: "remember", remember: false }) });
        setVault((old) => ({ ...old, remembered: response.remembered }));
        setToast("La clave recordada se quitó del archivo .env.");
      } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo quitar la clave recordada."); }
    } else if (vault.unlocked) {
      setToast("Escribe la clave maestra y pulsa Guardar recuerdo.");
      vaultKeyInputRef.current?.focus();
    }
  }
  async function saveRememberedVaultKey() {
    try {
      const response = await requestJson<VaultState>("/api/vault", { method: "POST", body: JSON.stringify({ action: "remember", remember: true, passphrase: vaultKey }) });
      setVault(response); setVaultKey(""); setRememberVaultKey(Boolean(response.remembered)); rememberedPreferenceLoaded.current = true; setToast("La clave se recordará y se validará al iniciar.");
    } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo guardar el recuerdo de la clave."); }
  }
  async function resetVaultAction() {
    const accepted = window.confirm("Se borrarán la clave maestra y las credenciales de correo cifradas. Tus seguimientos, horarios, destinatario e historial se conservarán. Después crearás una clave maestra nueva. ¿Continuar?");
    if (!accepted) return;
    try {
      await requestJson("/api/vault", { method: "POST", body: JSON.stringify({ action: "reset", confirmation: "RESET_VAULT" }) });
      setVaultKey(""); setRememberVaultKey(false); setEmailJsConfig({ serviceId: "", templateId: "", publicKey: "", privateKey: "" }); setEmailJsConfigured(false); setEmailJsPrivateKeyConfigured(false); setSettings((old) => ({ ...old, senderEmail: null }));
      await refresh(); setToast("Bóveda restablecida. Crea una clave maestra nueva y configura Gmail.");
    } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo restablecer la bóveda."); }
  }
  async function testEmail() {
    setTestingEmail(true);
    try { await requestJson("/api/email/test", { method: "POST", body: "{}" }); setToast("Correo de prueba enviado."); }
    catch (error) { setToast(error instanceof Error ? error.message : "No se pudo enviar el correo de prueba."); }
    finally { setTestingEmail(false); }
  }
  async function stopApplication() {
    if (runner.running || lifecycleAction !== "idle") return;
    // Send the stop request as a keepalive, then try to close synchronously
    // within the button's click event so browsers are more likely to allow it.
    const stopRequest = requestJson("/api/lifecycle", { method: "POST", body: JSON.stringify({ action: "stop" }), keepalive: true });
    setLifecycleAction("stopping"); setToast("Cerrando aplicación...");
    broadcastLifecycle("stop");
    closeCurrentTab();
    try {
      await stopRequest;
    } catch (error) {
      if (!window.closed) { setLifecycleAction("idle"); setToast(error instanceof Error ? error.message : "No se pudo cerrar la aplicación."); }
    }
  }
  async function restartApplication() {
    if (runner.running || lifecycleAction !== "idle") return;
    setLifecycleAction("restarting"); setToast("Reiniciando aplicación...");
    try {
      await requestJson("/api/lifecycle", { method: "POST", body: JSON.stringify({ action: "restart" }) });
      let sawServerStop = false;
      const startedAt = Date.now();
      for (let attempt = 0; attempt < 180; attempt++) {
        await delay(500);
        try {
          const response = await fetch("/api/lifecycle/health", { cache: "no-store" });
          if (!response.ok) sawServerStop = true;
          else if (sawServerStop || Date.now() - startedAt > 2_500) {
            sessionStorage.setItem(restartSessionKey, "1");
            broadcastLifecycle("reload");
            window.location.reload();
            return;
          }
        } catch { sawServerStop = true; }
      }
      throw new Error("La aplicación no volvió a responder en 90 segundos. Intenta iniciarla desde INICIAR_VUELA.bat.");
    } catch (error) {
      setLifecycleAction("idle");
      setToast(error instanceof Error ? error.message : "No se pudo reiniciar la aplicación.");
    }
  }
  function openVaultKeyField() {
    focusVaultKeyOnSettings.current = true;
    setPage("settings");
  }

  const title = navItems.find((item) => item.key === page)?.title ?? "Resumen";
  const nextTime = bogotaClock ? settings.scheduleTimes.find((time) => time > bogotaClock) ?? settings.scheduleTimes[0] : null;

  return <div className="min-h-screen text-[#1b2922]">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[246px] flex-col border-r border-[#e5eae3] bg-[#fbfcf9]/90 px-4 py-5 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-3 px-2"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#147a59] text-white shadow-sm"><Plane size={20} strokeWidth={2}/></span><div><p className="text-[17px] font-bold tracking-[-.05em]">vuela<span className="text-[#14805a]">.</span></p><p className="text-[10px] font-medium uppercase tracking-[.14em] text-[#748179]">price watcher</p></div></div>
      <div className="mt-10 px-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#75827a]">Espacio personal</div>
      <nav className="mt-3 grid gap-1">{navItems.map(({ key, title: itemTitle, icon: Icon }) => <button key={key} onClick={() => setPage(key)} className={`flex h-11 items-center gap-3 rounded-xl px-3 text-left text-[13px] font-medium transition ${page === key ? "bg-[#eaf3ec] text-[#176d4f]" : "text-[#738078] hover:bg-[#f1f5f0] hover:text-[#34443b]"}`}><Icon size={17} strokeWidth={1.8}/>{itemTitle}{key === "followups" && <span className="ml-auto rounded-md bg-white/75 px-2 py-0.5 text-[11px] text-[#77857d]">{followUps.length}</span>}</button>)}</nav>
      <div className="mt-auto rounded-2xl border border-[#e5ece5] bg-white p-4 card-shadow"><div className="flex items-center gap-2 text-xs font-semibold text-[#44544a]"><span className={`h-2 w-2 rounded-full ${runner.running ? "animate-pulse bg-[#d08b37]" : "bg-[#2da46b]"}`}/>{runner.running ? "Consulta en curso" : "Vigilancia activa"}</div><p className="mt-2 text-[11px] leading-5 text-[#849088]">{runner.running ? runner.currentLabel ?? "Procesando seguimientos…" : `Próxima revisión · ${bogotaClock ? nextTime ?? "sin horario" : "—"}`}</p><div className="mt-3 flex items-center gap-1 text-[10px] text-[#9aa59e]"><span className="h-1.5 w-1.5 rounded-full bg-[#68b688]"/> Ventana local · Bogotá</div></div>
    </aside>

    <main className="min-h-screen lg:pl-[246px]">
      <header className="sticky top-0 z-10 border-b border-[#e6ebe5]/80 bg-[#f8faf6]/80 px-5 py-3 backdrop-blur-xl sm:px-8 lg:px-10"><div className="mx-auto flex max-w-[1320px] items-center justify-between"><div className="flex items-center gap-3 lg:hidden"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#147a59] text-white"><Plane size={18}/></span><span className="font-bold tracking-[-.04em]">vuela.</span></div><div className="hidden lg:block"><p className="text-xs text-[#93a098]">Tu espacio <span className="px-1.5">/</span><span className="font-medium text-[#54635b]">{title}</span></p></div><div className="flex items-center gap-1.5 sm:gap-2.5"><span className="hidden items-center gap-1.5 rounded-full border border-[#e3e9e2] bg-white/70 px-3 py-1.5 text-[11px] font-medium text-[#6d7b72] xl:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#31a56d]"/> {runner.running ? "Revisando vuelos" : "Scheduler conectado"}</span><button type="button" onClick={() => void stopApplication()} disabled={runner.running || lifecycleAction !== "idle"} title="Cerrar aplicación" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#e1e7e0] bg-white px-2.5 text-xs font-semibold text-[#59685f] transition hover:bg-[#f2f6f1] disabled:opacity-50 sm:px-3"><Power size={15}/><span className="hidden sm:inline">Cerrar app</span></button><button type="button" onClick={() => void restartApplication()} disabled={runner.running || lifecycleAction !== "idle"} title="Reiniciar aplicación" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[#147a59] px-2.5 text-xs font-semibold text-white transition hover:bg-[#106b4e] disabled:opacity-50 sm:px-3"><RotateCw size={15} className={lifecycleAction === "restarting" ? "animate-spin" : ""}/><span className="hidden sm:inline">Reiniciar</span></button><button onClick={() => setPage("settings")} aria-label="Abrir configuración" className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e1e7e0] bg-white text-xs font-semibold text-[#4f6759]">V</button></div></div></header>

      <div className="mx-auto max-w-[1320px] px-5 pb-12 pt-8 sm:px-8 lg:px-10 lg:pt-10">
        <div className="mb-7 flex gap-1 overflow-x-auto lg:hidden">{navItems.map(({ key, title: itemTitle, icon: Icon }) => <button key={key} onClick={() => setPage(key)} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${page === key ? "bg-[#e6f1e9] text-[#176d4f]" : "text-[#77837c]"}`}><Icon size={15}/>{itemTitle}</button>)}</div>

        {page === "overview" && <>
          {vault.configured && !vault.unlocked && <section role="alert" className="mb-6 flex flex-col gap-4 rounded-2xl border-2 border-[#b94d45] bg-[#fff0ed] p-4 shadow-md sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-start gap-3"><span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#b94d45] text-white"><LockKeyhole size={19}/></span><div><h2 className="font-bold text-[#8f302c]">La bóveda está bloqueada</h2><p className="mt-1 text-sm leading-5 text-[#773b37]">Las alertas de precio no podrán enviarse hasta que desbloquees la bóveda.</p></div></div>
            <button type="button" onClick={openVaultKeyField} className="focus-ring shrink-0 rounded-xl bg-[#a83d38] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#8f302c]">Desbloquear bóveda</button>
          </section>}
          <section className="animate-in flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-[#23805c]"><Sparkles size={14}/> Tu radar de vuelos</div><h1 className="mt-3 text-[34px] font-semibold leading-none tracking-[-.055em] text-[#1a2821] sm:text-[42px]">Buenos precios,<br className="sm:hidden"/> sin estar buscando.</h1><p className="mt-3 max-w-lg text-sm leading-6 text-[#7a877f]">Seguimos tus rutas y te avisamos cuando aparezca una tarifa que vale la pena.</p></div><div className="flex gap-2"><button onClick={() => void runNow()} disabled={busy || runner.running || activeCount === 0} className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl border border-[#dce5dc] bg-white px-4 text-sm font-semibold text-[#52635a] transition hover:bg-[#f5f8f4] disabled:opacity-50"><RefreshCw size={15} className={runner.running ? "animate-spin" : ""}/>Revisar ahora</button><PrimaryButton onClick={() => setModal(null)}><Plus size={16}/> Nuevo seguimiento</PrimaryButton></div></section>

          <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Seguimientos activos" value={String(activeCount).padStart(2, "0")} detail={`de ${followUps.length} configurados`} icon={Compass} tone="green"/>
            <StatCard label="Alertas encontradas" value={String(matchRuns.length).padStart(2, "0")} detail="en el historial reciente" icon={Bell} tone="amber"/>
            <StatCard label="Próxima revisión" value={nextTime ?? "—"} detail="Hora de Bogotá" icon={Clock3} tone="blue"/>
            <div className="card-shadow flex items-center justify-between rounded-[18px] border border-[#e6ebe5] bg-white p-5"><div><p className="text-xs font-medium text-[#849088]">Tendencia de precios</p><p className="mt-2 text-sm font-semibold text-[#314138]">Tus rutas bajo control</p><p className="mt-1 text-[11px] text-[#98a29c]">Consulta programada</p></div><PriceSparkline/></div>
          </section>

          <section className="mt-10"><div className="mb-4 flex items-end justify-between"><div><div className="flex items-center gap-2"><h2 className="text-[19px] font-semibold tracking-[-.035em]">Tus seguimientos</h2><span className="rounded-full bg-[#edf3ee] px-2 py-0.5 text-[11px] font-semibold text-[#63756a]">{followUps.length}</span></div><p className="mt-1 text-xs text-[#8b9790]">Rutas y precios objetivo que estás vigilando.</p></div><button onClick={() => setPage("followups")} className="hidden items-center gap-1 text-xs font-semibold text-[#217c59] sm:flex">Ver todos <ArrowRight size={14}/></button></div>
            {followUps.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{followUps.slice(0, 3).map((item) => <FollowUpCard key={item.id} followUp={item} onEdit={() => setModal(item)} onToggle={() => void toggleStatus(item)} onDelete={() => void deleteItem(item)} onRun={() => void runNow(item.id)} running={runner.running || busy}/>)}</div> : <EmptyState onCreate={() => setModal(null)}/>}
          </section>
          <section className="mt-10"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-[19px] font-semibold tracking-[-.035em]">Actividad reciente</h2><p className="mt-1 text-xs text-[#8b9790]">Precios consultados y avisos enviados.</p></div><button onClick={() => setPage("history")} className="inline-flex items-center gap-1 text-xs font-semibold text-[#217c59]">Ver historial <ArrowRight size={14}/></button></div><div className="card-shadow rounded-[18px] border border-[#e6ebe5] bg-white px-5">{runs.slice(0, 4).length ? runs.slice(0, 4).map((run) => <HistoryRow key={run.id} run={run} onStop={stopExecution} progress={runner.currentRunId === run.id ? runner.progress : null}/>) : <div className="py-9 text-center text-sm text-[#8d9992]">Todavía no hay consultas. Tus ejecuciones aparecerán aquí.</div>}</div></section>
        </>}

        {page === "followups" && <>
          <PageHeading eyebrow="Rutas guardadas" title="Seguimientos" description="Administra tus rutas y define cuándo recibir una alerta." action={<PrimaryButton onClick={() => setModal(null)}><Plus size={16}/> Nuevo seguimiento</PrimaryButton>}/>
          <div className="mb-5 mt-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="relative max-w-sm flex-1"><Search size={16} className="absolute left-3.5 top-3.5 text-[#9aa59e]"/><input className={`${inputClass} pl-10`} placeholder="Buscar por ruta o nombre…" value={query} onChange={(e) => setQuery(e.target.value)}/></div><span className="text-xs text-[#68766e]">{activeCount} activos · {followUps.length - activeCount} en pausa</span></div>
          {filteredFollowUps.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredFollowUps.map((item) => <FollowUpCard key={item.id} followUp={item} onEdit={() => setModal(item)} onToggle={() => void toggleStatus(item)} onDelete={() => void deleteItem(item)} onRun={() => void runNow(item.id)} running={runner.running || busy}/>)}</div> : <EmptyState onCreate={() => setModal(null)}/>}
        </>}

        {page === "history" && <>
          <PageHeading eyebrow="Últimos movimientos" title="Historial" description={`Consultas y alertas guardadas durante los últimos ${settings.historyRetentionDays} días.`} action={<div className="flex gap-2"><button onClick={() => void refresh()} className="focus-ring flex h-10 items-center gap-2 rounded-xl border border-[#dfe7df] bg-white px-3 text-sm font-medium text-[#65746b]"><RefreshCw size={14}/> Actualizar</button><button onClick={() => void clearAllHistory()} disabled={!runs.length || clearingHistory || runner.running} className="focus-ring flex h-10 items-center gap-2 rounded-xl border border-[#f1d6d2] bg-white px-3 text-sm font-medium text-[#a7433b] hover:bg-[#fff7f5]"><Trash2 size={14}/>{clearingHistory ? "Borrando…" : "Borrar historial"}</button></div>}/>
          <div className="mt-7 grid gap-3 sm:grid-cols-3"><MiniStat label="Ejecuciones" value={filteredRuns.length}/><MiniStat label="Alertas de precio" value={filteredRuns.filter((run) => run.results.some((result) => result.meetsThreshold)).length}/><MiniStat label="Fallos registrados" value={filteredRuns.filter((run) => run.status === "failed").length}/></div>
          <div className="card-shadow mt-5 rounded-[18px] border border-[#e6ebe5] bg-white px-5">
            <div className="grid gap-3 border-b border-[#edf0ed] py-4 sm:grid-cols-3 sm:items-end">
              <label className="grid gap-1.5 text-xs font-medium text-[#56655c]"><span>Seguimiento</span><select aria-label="Filtrar historial por seguimiento" className={`${inputClass} h-10`} value={historyFollowUpId} onChange={(event) => setHistoryFollowUpId(event.target.value)}><option value="">Todos</option>{historyFollowUps.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <label className="grid gap-1.5 text-xs font-medium text-[#56655c]"><span>Desde</span><input aria-label="Historial desde" type="date" className={`${inputClass} h-10`} value={historyFrom} max={historyTo || undefined} onChange={(event) => setHistoryFrom(event.target.value)}/></label>
              <label className="grid gap-1.5 text-xs font-medium text-[#56655c]"><span>Hasta</span><input aria-label="Historial hasta" type="date" className={`${inputClass} h-10`} value={historyTo} min={historyFrom || undefined} onChange={(event) => setHistoryTo(event.target.value)}/></label>
            </div>
            <div className="flex items-center justify-between border-b border-[#edf0ed] py-4"><h2 className="text-sm font-semibold">Ejecuciones</h2><span className="text-[11px] text-[#929d96]">{filteredRuns.length} · Más recientes primero</span></div>
            <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(180px,.9fr)_minmax(160px,.8fr)_minmax(140px,.65fr)] gap-3 border-b border-[#e7ece7] bg-[#f7f9f6] py-3 text-[10px] font-semibold uppercase tracking-wide text-[#718077] xl:grid"><span>Seguimiento</span><span>Fecha ejecución</span><span>Estado</span><span>Precio mínimo encontrado</span></div>
            {filteredRuns.length ? filteredRuns.map((run) => <HistoryRow key={run.id} run={run} onStop={stopExecution} progress={runner.currentRunId === run.id ? runner.progress : null}/>) : <div className="py-14 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f1f5f0] text-[#8a9990]"><History size={20}/></span><p className="mt-3 text-sm font-semibold text-[#47574d]">{runs.length ? "No hay ejecuciones para estos filtros" : "Tu historial está tranquilo"}</p><p className="mt-1 text-xs text-[#8c9891]">{runs.length ? "Cambia el seguimiento o las fechas para ver más resultados." : "Las ejecuciones y alertas aparecerán aquí."}</p></div>}
          </div>
        </>}

        {page === "diagnostics" && <>
          <PageHeading eyebrow="Registro local" title="Diagnóstico" description="Eventos de configuración y auditoría de tiempos por ejecución. Los logs se conservan localmente; las credenciales se ocultan." action={<div className="flex gap-2"><button onClick={() => void refresh()} className="focus-ring flex h-10 items-center gap-2 rounded-xl border border-[#dfe7df] bg-white px-3 text-sm font-medium text-[#65746b]"><RefreshCw size={14}/> Actualizar</button><button onClick={() => setDiagnosticsLimit((limit) => Math.min(5000, limit + 200))} disabled={diagnostics.length < diagnosticsLimit || diagnosticsLimit >= 5000} className="focus-ring flex h-10 items-center gap-2 rounded-xl border border-[#dfe7df] bg-white px-3 text-sm font-medium text-[#65746b] disabled:opacity-50">Cargar 200 más</button></div>}/>
          <div className="card-shadow mt-7 rounded-[18px] border border-[#e6ebe5] bg-white px-5">
            <div className="flex items-center justify-between border-b border-[#edf0ed] py-4"><h2 className="text-sm font-semibold">Eventos recientes</h2><span className="text-[11px] text-[#929d96]">{diagnostics.length} eventos cargados · más recientes primero</span></div>
            {diagnostics.length ? diagnostics.map((entry) => <article key={entry.id} className="grid gap-2 border-b border-[#edf0ed] py-4 last:border-0 sm:grid-cols-[145px_1fr]"><div><p className="text-xs font-semibold text-[#4c5b52]">{entry.area} · {entry.event}</p><p className="mt-1 text-[11px] text-[#8c9891]">{formatDateTime(entry.createdAt)}</p></div><div className="flex items-start gap-2"><span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${entry.outcome === "success" ? "bg-[#e8f4ec] text-[#177b55]" : entry.outcome === "error" ? "bg-[#fff0ed] text-[#b94d45]" : entry.outcome === "warning" ? "bg-[#fff3e4] text-[#a86b21]" : "bg-[#f1f4f1] text-[#728078]"}`}>{entry.outcome === "success" ? "Correcto" : entry.outcome === "error" ? "Error" : entry.outcome === "warning" ? "Aviso" : "Info"}</span><p className="text-xs leading-5 text-[#58675e]">{entry.message}</p></div></article>) : <div className="py-14 text-center text-sm text-[#8c9891]">Todavía no hay eventos. Los pasos de configuración y tus pruebas aparecerán aquí.</div>}
          </div>
        </>}

        {page === "settings" && <>
          <PageHeading eyebrow="Preferencias de la app" title="Configuración" description="Horarios, destinatario y servicio de envío de correos."/>
          <div className="mt-7 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
            <form onSubmit={saveAppSettings} className="card-shadow rounded-[20px] border border-[#e6ebe5] bg-white p-5 sm:p-6 xl:self-start">
              <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f4ec] text-[#18805a]"><Clock3 size={18}/></span><div><h2 className="font-semibold">Revisiones diarias</h2><p className="mt-1 text-xs leading-5 text-[#68766e]">Todos los horarios se calculan en la zona horaria de Bogotá.</p></div></div>
              <div className="mt-5"><p className="text-xs font-semibold text-[#56655c]">Horas de consulta</p><div className="mt-2 flex flex-wrap gap-2">{settings.scheduleTimes.map((time, index) => <div key={`${time}-${index}`} className="flex items-center gap-1 rounded-xl border border-[#e1e8e1] bg-[#fbfcfa] p-1"><input aria-label={`Horario ${index + 1}`} type="time" className="h-9 w-[132px] bg-transparent px-2 text-sm font-medium text-[#425248] outline-none" value={time} onChange={(event) => setSettings((old) => ({ ...old, scheduleTimes: old.scheduleTimes.map((item, i) => i === index ? event.target.value : item) }))}/><IconButton label="Quitar horario" onClick={() => setSettings((old) => ({ ...old, scheduleTimes: old.scheduleTimes.filter((_, i) => i !== index) }))}><X size={14}/></IconButton></div>)}<button type="button" onClick={() => setSettings((old) => ({ ...old, scheduleTimes: [...old.scheduleTimes, "18:00"].slice(0, 12) }))} className="flex h-11 items-center gap-1.5 rounded-xl border border-dashed border-[#cbd9ce] px-3 text-xs font-semibold text-[#217c59] hover:bg-[#f4f8f3]"><Plus size={14}/> Añadir hora</button></div></div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Correo destinatario"><input className={inputClass} type="email" value={settings.recipientEmail} placeholder="tu-correo@hotmail.com" onChange={(event) => setSettings((old) => ({ ...old, recipientEmail: event.target.value }))}/></Field><Field label="Retención de historial" hint="Los registros anteriores se limpian automáticamente."><div className="relative"><input className={`${inputClass} pr-16`} type="number" min={1} max={3650} value={settings.historyRetentionDays} onChange={(event) => setSettings((old) => ({ ...old, historyRetentionDays: Number(event.target.value) }))}/><span className="absolute right-3 top-3 text-xs text-[#89958e]">días</span></div></Field></div>
              <div className="mt-5 flex items-center justify-between rounded-xl bg-[#f7f9f6] px-3.5 py-3"><div><p className="text-sm font-medium">Automatización programada</p><p className="mt-0.5 text-xs text-[#859189]">El proceso debe seguir abierto para ejecutar.</p></div><button type="button" role="switch" aria-checked={settings.schedulerEnabled} onClick={() => setSettings((old) => ({ ...old, schedulerEnabled: !old.schedulerEnabled }))} className={`relative h-6 w-11 rounded-full transition ${settings.schedulerEnabled ? "bg-[#18805d]" : "bg-[#c7d0c9]"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${settings.schedulerEnabled ? "left-6" : "left-1"}`}/></button></div>
              {settingsSaved && <p className="mt-3 flex items-center gap-1.5 text-xs text-[#178057]"><Check size={14}/> Configuración guardada</p>}
              <div className="mt-5 flex justify-end"><PrimaryButton type="submit" disabled={savingSettings || settings.scheduleTimes.length === 0}>{savingSettings ? "Guardando…" : "Guardar configuración"}</PrimaryButton></div>
            </form>

            <div className="grid content-start gap-5">
              <form onSubmit={saveEmailJsSettings} className="card-shadow rounded-[20px] border border-[#e6ebe5] bg-white p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eef1fb] text-[#5c69a9]"><Mail size={18}/></span><div><h2 className="font-semibold">Envío por EmailJS</h2><p className="mt-1 text-xs leading-5 text-[#68766e]">Conecta tu Gmail desde EmailJS. Vuela envía por HTTPS y conserva las claves en la bóveda cifrada.</p></div></div>
                <div className="mt-4 grid gap-3"><Field label="Service ID"><input className={inputClass} value={emailJsConfig.serviceId} placeholder="service_..." autoComplete="off" disabled={!vault.unlocked} onChange={(event) => setEmailJsConfig((old) => ({ ...old, serviceId: event.target.value }))}/></Field><Field label="Template ID"><input className={inputClass} value={emailJsConfig.templateId} placeholder="template_..." autoComplete="off" disabled={!vault.unlocked} onChange={(event) => setEmailJsConfig((old) => ({ ...old, templateId: event.target.value }))}/></Field><Field label="Public Key"><input className={inputClass} value={emailJsConfig.publicKey} placeholder="Public Key de Account" autoComplete="off" disabled={!vault.unlocked} onChange={(event) => setEmailJsConfig((old) => ({ ...old, publicKey: event.target.value }))}/></Field><Field label="Private Key (opcional)" hint="Se cifra en la bóveda. Si ya está guardada y lo dejas vacío, se conserva."><input className={inputClass} type="password" autoComplete="new-password" value={emailJsConfig.privateKey} placeholder={emailJsPrivateKeyConfigured ? "Private Key guardada" : "Opcional; puedes dejarla vacía"} disabled={!vault.unlocked} onChange={(event) => setEmailJsConfig((old) => ({ ...old, privateKey: event.target.value }))}/></Field></div>
                <div className="mt-4 flex flex-wrap items-center gap-2"><PrimaryButton type="submit" disabled={savingEmailJs || !vault.unlocked}>{savingEmailJs ? "Guardando…" : "Guardar EmailJS"}</PrimaryButton><span className={"rounded-full px-2.5 py-1 text-[10px] font-semibold " + (emailJsConfigured ? "bg-[#e8f4ec] text-[#177b55]" : "bg-[#f2f4f1] text-[#7d8981]")}>{emailJsConfigured ? "Configurado" : "Sin configurar"}</span></div>
                <div className="mt-3 flex flex-wrap items-center gap-2"><PrimaryButton onClick={() => void testEmail()} disabled={testingEmail || !emailJsConfigured || !settings.recipientEmail || !vault.unlocked}><Mail size={14}/>{testingEmail ? "Enviando…" : "Enviar correo de prueba"}</PrimaryButton><p className="text-xs text-[#78867d]">La prueba se envía al correo destinatario configurado.</p></div>
                {!vault.unlocked && <p className="mt-3 text-[11px] leading-5 text-[#a16d2c]">Desbloquea la bóveda para configurar EmailJS.</p>}
              </form>

              <section className="card-shadow rounded-[20px] border border-[#e6ebe5] bg-white p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff3e6] text-[#b4772a]"><ShieldCheck size={18}/></span><div><h2 className="font-semibold">Bóveda local cifrada</h2><p className="mt-1 text-xs leading-5 text-[#68766e]">Las claves de EmailJS se cifran en el archivo local. La clave maestra solo permanece en memoria mientras está desbloqueada.</p></div></div>
                <div className="mt-4 flex gap-2"><div className="relative min-w-0 flex-1"><input ref={vaultKeyInputRef} className={`${inputClass} pr-11`} type={showVaultKey ? "text" : "password"} autoComplete={vault.configured ? "current-password" : "new-password"} value={vaultKey} placeholder={vault.configured ? "Clave maestra" : "Crea una clave de 12+ caracteres"} onChange={(event) => setVaultKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!vault.configured) void vaultAction("setup"); else if (!vault.unlocked) void vaultAction("unlock"); } }}/><button type="button" aria-label={showVaultKey ? "Ocultar clave maestra" : "Mostrar clave maestra"} onClick={() => setShowVaultKey((value) => !value)} className="absolute right-2 top-2.5 rounded-lg p-1.5 text-[#79867f] hover:bg-[#f1f5f1]">{showVaultKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>{!vault.configured ? <button onClick={() => void vaultAction("setup")} className="focus-ring shrink-0 rounded-xl bg-[#273c30] px-3 text-xs font-semibold text-white">Crear bóveda</button> : vault.unlocked ? <button onClick={() => void vaultAction("lock")} className="focus-ring shrink-0 rounded-xl border border-[#e1e7e1] px-3 text-xs font-semibold text-[#54645a]">Bloquear</button> : <button onClick={() => void vaultAction("unlock")} className="focus-ring shrink-0 rounded-xl bg-[#273c30] px-3 text-xs font-semibold text-white">Desbloquear</button>}</div>
                <div className="mt-3 rounded-xl bg-[#f7f9f6] p-3"><label className="flex cursor-pointer items-start gap-2 text-xs font-medium text-[#425248]"><input type="checkbox" checked={rememberVaultKey} onChange={(event) => void toggleRememberVaultKey(event.target.checked)} className="mt-0.5 accent-[#18805d]"/><span>Recordar clave en el .env y desbloquear al iniciar</span></label><p className="ml-5 mt-1 text-[11px] leading-4 text-[#78867d]">La clave se guarda en texto legible en el archivo .env local del proyecto. Ese archivo está excluido de Git.</p>{vault.unlocked && rememberVaultKey && !vault.remembered && <button type="button" onClick={() => void saveRememberedVaultKey()} disabled={!vaultKey} className="mt-2 rounded-lg bg-[#273c30] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Guardar recuerdo</button>}</div>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#859189]"><LockKeyhole size={13}/>{vault.unlocked ? "Bóveda desbloqueada en memoria" : vault.configured ? "Bóveda bloqueada" : "Aún no configurada"}</div>
                {vault.configured && !vault.unlocked && <button type="button" onClick={() => void resetVaultAction()} className="mt-3 text-[11px] font-semibold text-[#a44940] underline underline-offset-2">Olvidé la clave maestra · Restablecer bóveda</button>}
              </section>

            </div>
          </div>
        </>}
      </div>
    </main>
    {modal !== false && <FollowUpModal initial={modal} onClose={() => setModal(false)} onSave={saveFollowUp}/>}
    {lifecycleAction === "restarting" && <div role="status" aria-live="polite" className="fixed inset-0 z-[90] flex items-center justify-center bg-[#14251d]/45 p-5 backdrop-blur-sm"><div className="flex w-full max-w-sm items-center gap-4 rounded-2xl bg-white p-5 shadow-2xl"><RotateCw size={22} className="shrink-0 animate-spin text-[#147a59]"/><div><p className="font-semibold text-[#27352e]">Reiniciando aplicación...</p><p className="mt-1 text-sm text-[#75817b]">La información cargará cuando el servidor esté listo.</p></div></div></div>}
    {toast && <div role="status" className="fixed bottom-5 left-1/2 z-[70] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl bg-[#23372c] px-4 py-3 text-sm text-white shadow-xl"><Check size={16} className="shrink-0 text-[#a7dfba]"/>{toast}<button onClick={() => setToast("")} className="ml-2 text-white/70 hover:text-white"><X size={14}/></button></div>}
  </div>;
}

function DateSectionPlaceholder() {}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="animate-in flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[.13em] text-[#23805c]">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.05em] text-[#1a2821]">{title}</h1><p className="mt-2 text-sm text-[#7a877f]">{description}</p></div>{action}</div>;
}

function StatCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof Activity; tone: "green" | "amber" | "blue" }) {
  const tones = { green: "bg-[#e8f4ec] text-[#16805a]", amber: "bg-[#fff3e4] text-[#b57a2b]", blue: "bg-[#edf1fb] text-[#6472af]" };
  return <div className="card-shadow rounded-[18px] border border-[#e6ebe5] bg-white p-5"><div className="flex items-center justify-between"><p className="text-xs font-medium text-[#829087]">{label}</p><span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tones[tone]}`}><Icon size={16}/></span></div><div className="mt-3 flex items-end justify-between"><p className="text-[28px] font-semibold leading-none tracking-[-.05em] text-[#24332a]">{value}</p><p className="text-[10px] text-[#a0aaa3]">{detail}</p></div></div>;
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="card-shadow rounded-[16px] border border-[#e6ebe5] bg-white px-4 py-4"><p className="text-xs text-[#859188]">{label}</p><p className="mt-1.5 text-xl font-semibold tracking-[-.04em]">{String(value).padStart(2, "0")}</p></div>;
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div className="card-shadow flex flex-col items-center rounded-[20px] border border-dashed border-[#d9e3da] bg-white/70 px-5 py-12 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-[19px] bg-[#eaf4ed] text-[#16805a]"><Plane size={23}/></span><h3 className="mt-4 text-sm font-semibold">Tu primer seguimiento empieza aquí</h3><p className="mt-1 max-w-sm text-xs leading-5 text-[#859188]">Agrega una ruta, define el precio que te gustaría pagar y deja que Vuela la revise.</p><PrimaryButton onClick={onCreate} className="mt-5"><Plus size={15}/> Crear seguimiento</PrimaryButton></div>;
}
