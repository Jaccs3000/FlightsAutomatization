"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownUp, ArrowLeftRight, ArrowRight, Bell, CalendarDays, Check, ChevronDown, Eye, EyeOff,
  CircleAlert, Clock3, Compass, ExternalLink, History, LockKeyhole, Mail, MapPin, Minus,
  MoreHorizontal, Pause, Plane, Plus, Play, RefreshCw, ScrollText, Search, Settings2, ShieldCheck,
  Sparkles, Trash2, TrendingDown, X,
} from "lucide-react";
import type { AppSettings, FollowUp, FollowUpInput, RunWithResults } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";

type PageKey = "overview" | "followups" | "history" | "settings" | "diagnostics";
type VaultState = { configured: boolean; unlocked: boolean };
type EmailJsCredentials = { serviceId: string; templateId: string; publicKey: string; privateKey: string };
type ApiError = { error?: string };
type DiagnosticLog = { id: string; createdAt: string; area: string; event: string; outcome: "info" | "success" | "warning" | "error"; message: string };

const navItems: Array<{ key: PageKey; title: string; icon: typeof Activity }> = [
  { key: "overview", title: "Resumen", icon: Activity },
  { key: "followups", title: "Seguimientos", icon: Plane },
  { key: "history", title: "Historial", icon: History },
  { key: "settings", title: "Configuración", icon: Settings2 },
  { key: "diagnostics", title: "Diagnóstico", icon: ScrollText },
];

const emptyForm = (): FollowUpInput => ({
  name: "", originIata: "", destinationIata: "", tripType: "round_trip",
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
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" }).format(new Date(value));
}

function bogotaDateKey(value: string) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Bogota" }).format(new Date(value));
}

function formatCop(value: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function formatObservedPrice(value: number, currency: string | null) {
  if (!currency || currency === "COP") return formatCop(value);
  return `${currency} ${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value)}`;
}

function dateDescription(mode: string, start: string, end: string | null) {
  if (mode === "exact") return formatDate(start, { year: "numeric" });
  return `${formatDate(start)} – ${formatDate(end, { year: "numeric" })}`;
}

function IconButton({ children, onClick, label, className = "" }: { children: React.ReactNode; onClick?: () => void; label: string; className?: string }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`focus-ring inline-flex h-9 w-9 items-center justify-center rounded-xl text-[#62716a] transition hover:bg-[#edf3ee] hover:text-[#147a59] ${className}`}>{children}</button>;
}

function PrimaryButton({ children, onClick, type = "button", disabled, className = "" }: { children: React.ReactNode; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; className?: string }) {
  return <button type={type} disabled={disabled} onClick={onClick} className={`focus-ring inline-flex items-center justify-center gap-2 rounded-xl bg-[#147a59] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0f6247] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
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
  const outbound = dateDescription(followUp.outboundMode, followUp.outboundStart, followUp.outboundEnd);
  const inbound = followUp.tripType === "round_trip" ? dateDescription(followUp.inboundMode ?? "exact", followUp.inboundStart ?? "", followUp.inboundEnd) : null;
  return (
    <article className="card-shadow animate-in rounded-[20px] border border-[#e6ebe5] bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#e8f4ec] text-[#147a59]"><Plane size={19} strokeWidth={1.8}/></span>
          <div className="min-w-0"><h3 className="truncate font-semibold text-[#1b2922]">{followUp.name}</h3><p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#7a867f]"><span className={`h-1.5 w-1.5 rounded-full ${followUp.status === "active" ? "bg-[#37a975]" : "bg-[#aeb7b1]"}`}/>{followUp.status === "active" ? "Activo" : "En pausa"}<span>·</span>{followUp.tripType === "round_trip" ? "Ida y vuelta" : "Solo ida"}</p></div>
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
        <span className="max-w-[43%] truncate text-sm font-semibold text-[#2e3b34]">{followUp.originIata}</span><ArrowRight size={15} className="shrink-0 text-[#91a098]"/><span className="max-w-[43%] truncate text-sm font-semibold text-[#2e3b34]">{followUp.destinationIata}</span><span className="ml-auto flex items-center gap-1 text-xs text-[#87938c]"><MapPin size={13}/> Aeropuertos</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#99a39d]">Salida</p><p className="mt-1 text-sm text-[#39473f]">{outbound}</p></div>
        {inbound && <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#99a39d]">Regreso</p><p className="mt-1 text-sm text-[#39473f]">{inbound}</p></div>}
        <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#99a39d]">Pasajeros</p><p className="mt-1 text-sm text-[#39473f]">{followUp.adults} adulto{followUp.adults === 1 ? "" : "s"}</p></div>
        <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-[#99a39d]">Avisar hasta</p><p className="mt-1 text-sm font-semibold text-[#147a59]">{formatCop(followUp.maxPriceCop)}</p></div>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-[#edf0ed] pt-4"><span className="inline-flex items-center gap-1.5 text-xs text-[#79867f]"><Clock3 size={13}/> Próxima revisión diaria</span><button onClick={onEdit} className="inline-flex items-center gap-1 text-xs font-semibold text-[#147a59] hover:text-[#0f6247]">Ver detalle <ArrowRight size={13}/></button></div>
    </article>
  );
}

function FollowUpModal({ initial, onClose, onSave }: { initial: FollowUp | null; onClose: () => void; onSave: (data: FollowUpInput, id?: string) => Promise<void> }) {
  const [form, setForm] = useState<FollowUpInput>(() => initial ? {
    name: initial.name, originIata: initial.originIata, destinationIata: initial.destinationIata,
    tripType: initial.tripType, outboundMode: initial.outboundMode, outboundStart: initial.outboundStart,
    outboundEnd: initial.outboundEnd, inboundMode: initial.inboundMode ?? "exact", inboundStart: initial.inboundStart,
    inboundEnd: initial.inboundEnd, stayNights: initial.stayNights, adults: initial.adults,
    maxPriceCop: initial.maxPriceCop, status: initial.status,
  } : emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (key: keyof FollowUpInput, value: unknown) => setForm((old) => ({ ...old, [key]: value }));
  const dateInput = "focus-ring h-11 w-full rounded-xl border border-[#dce4dd] bg-white px-3 text-sm text-[#26342c] outline-none focus:border-[#73ad90]";
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const payload: FollowUpInput = {
      ...form,
      originIata: form.originIata.toUpperCase(),
      destinationIata: form.destinationIata.toUpperCase(),
      outboundEnd: form.outboundMode === "flexible" ? form.outboundEnd || null : null,
      inboundMode: form.tripType === "round_trip" ? form.inboundMode ?? "exact" : null,
      inboundStart: form.tripType === "round_trip" ? form.inboundStart || null : null,
      inboundEnd: form.tripType === "round_trip" && form.inboundMode === "flexible" ? form.inboundEnd || null : null,
      stayNights: form.tripType === "round_trip" ? form.stayNights : null,
    };
    try { await onSave(payload, initial?.id); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#14231c]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form onSubmit={submit} className="animate-in max-h-[94vh] w-full max-w-[680px] overflow-y-auto rounded-t-[24px] border border-[#e5ebe5] bg-white p-5 shadow-2xl sm:rounded-[24px] sm:p-7">
      <div className="flex items-start justify-between"><div><span className="text-xs font-semibold uppercase tracking-[.12em] text-[#26805d]">{initial ? "Editar seguimiento" : "Nuevo seguimiento"}</span><h2 className="mt-1 text-2xl font-semibold tracking-[-.04em] text-[#1b2922]">Configuremos tu alerta</h2></div><IconButton label="Cerrar" onClick={onClose}><X size={19}/></IconButton></div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Nombre del seguimiento"><input className={inputClass} value={form.name} placeholder="Ej. Vacaciones de mitad de año" onChange={(e) => update("name", e.target.value)} required maxLength={80}/></Field></div>
        <Field label="Origen · código IATA"><input className={`${inputClass} uppercase`} value={form.originIata} placeholder="BOG" maxLength={3} onChange={(e) => update("originIata", e.target.value.toUpperCase())} required/></Field>
        <Field label="Destino · código IATA"><input className={`${inputClass} uppercase`} value={form.destinationIata} placeholder="CLO" maxLength={3} onChange={(e) => update("destinationIata", e.target.value.toUpperCase())} required/></Field>
        <Field label="Tipo de viaje"><select className={inputClass} value={form.tripType} onChange={(e) => update("tripType", e.target.value)}><option value="round_trip">Ida y vuelta</option><option value="one_way">Solo ida</option></select></Field>
        <Field label="Adultos" hint="Debe viajar al menos un adulto."><div className="flex h-11 items-center justify-between rounded-xl border border-[#dce4dd] px-3"><button type="button" onClick={() => update("adults", Math.max(1, form.adults - 1))} className="rounded-lg p-1.5 text-[#64736b] hover:bg-[#f1f5f1]"><Minus size={15}/></button><span className="text-sm font-semibold">{form.adults}</span><button type="button" onClick={() => update("adults", Math.min(9, form.adults + 1))} className="rounded-lg p-1.5 text-[#147a59] hover:bg-[#eaf4ed]"><Plus size={15}/></button></div></Field>
        <DateSection label="Salida" mode={form.outboundMode} start={form.outboundStart} end={form.outboundEnd ?? ""} onMode={(value) => update("outboundMode", value)} onStart={(value) => update("outboundStart", value)} onEnd={(value) => update("outboundEnd", value)} required/>
        {form.tripType === "round_trip" && <DateSection label="Regreso" mode={form.inboundMode ?? "exact"} start={form.inboundStart ?? ""} end={form.inboundEnd ?? ""} onMode={(value) => update("inboundMode", value)} onStart={(value) => update("inboundStart", value)} onEnd={(value) => update("inboundEnd", value)} required/>}
        {form.tripType === "round_trip" && <Field label="Duración de estadía" hint="Opcional. Si la dejas vacía, se consideran combinaciones válidas de al menos una noche."><div className="relative"><input className={`${inputClass} pr-20`} type="number" min={1} max={365} value={form.stayNights ?? ""} placeholder="Cualquier duración" onChange={(e) => update("stayNights", e.target.value ? Number(e.target.value) : null)}/><span className="absolute right-3 top-3 text-xs text-[#89958e]">noches</span></div></Field>}
        <div className="sm:col-span-2"><Field label="Precio máximo total · COP" hint="Se enviará una alerta si el precio es igual o menor a este valor."><div className="relative"><span className="absolute left-3.5 top-3 text-sm text-[#839087]">$</span><input className={`${inputClass} pl-8`} type="number" min={1} step={1} value={form.maxPriceCop} onChange={(e) => update("maxPriceCop", Number(e.target.value))} required/><span className="absolute right-3.5 top-3 text-xs text-[#89958e]">COP</span></div></Field></div>
      </div>
      {error && <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#fff2ef] px-3.5 py-3 text-sm text-[#ac433c]"><CircleAlert size={17} className="mt-0.5 shrink-0"/>{error}</p>}
      <div className="mt-7 flex justify-end gap-2 border-t border-[#edf0ed] pt-5"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-medium text-[#617067] hover:bg-[#f3f6f3]">Cancelar</button><PrimaryButton type="submit" disabled={saving}>{saving ? "Guardando…" : initial ? "Guardar cambios" : "Crear seguimiento"}<ArrowRight size={16}/></PrimaryButton></div>
    </form>
  </div>;
}

function DateSection({ label, mode, start, end, onMode, onStart, onEnd, required }: { label: string; mode: "exact" | "flexible"; start: string; end: string; onMode: (mode: "exact" | "flexible") => void; onStart: (date: string) => void; onEnd: (date: string) => void; required?: boolean }) {
  return <div className="grid gap-1.5 text-sm font-medium text-[#3c4a43]"><span>{label} {required && <span className="text-[#b94d45">*</span>}</span><div className="grid grid-cols-[1fr_1fr] gap-2"><select aria-label={`${label}: tipo de fecha`} className={`${inputClass} min-w-0 px-2.5`} value={mode} onChange={(event) => onMode(event.target.value as "exact" | "flexible")}><option value="exact">Día exacto</option><option value="flexible">Rango flexible</option></select><input aria-label={`${label}: fecha inicial`} className={`${inputClass} min-w-0 px-2.5`} type="date" value={start} onChange={(event) => onStart(event.target.value)} required/></div>{mode === "flexible" && <input aria-label={`${label}: fecha final`} className={`${inputClass} mt-1`} type="date" min={start} value={end} onChange={(event) => onEnd(event.target.value)} required/>}</div>;
}

function HistoryRow({ run }: { run: RunWithResults }) {
  const [expanded, setExpanded] = useState(false);
  const matches = run.results.filter((result) => result.meetsThreshold);
  const snapshot = run.snapshot;
  const hasDetails = Boolean(snapshot) || run.results.length > 0 || Boolean(run.scheduledAt) || Boolean(run.notificationRecipient) || Boolean(run.notificationError);
  return <article className="grid gap-3 border-b border-[#edf0ed] py-4 last:border-0 sm:grid-cols-[1fr_150px_150px] sm:items-center">
    <div className="flex min-w-0 gap-3"><span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${run.status === "failed" ? "bg-[#fff0ed] text-[#b94d45]" : matches.length ? "bg-[#e7f4ec] text-[#18825c]" : "bg-[#f0f3ef] text-[#78847e]"}`}>{run.status === "failed" ? <CircleAlert size={17}/> : matches.length ? <TrendingDown size={17}/> : <Plane size={16}/>}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#27352e]">{run.followUpName}</p><p className="mt-1 truncate text-xs text-[#839087]">{run.error ?? (matches.length ? `${matches.length} precio(s) bajo el límite` : run.results.length ? `${run.results.length} precio(s) revisados` : statusLabel(run.status))}</p></div></div>
    <div className="text-xs text-[#728078]"><p>{formatDateTime(run.startedAt)}</p><p className="mt-1 text-[11px] text-[#98a29b]">{run.runType === "scheduled" ? "Programada" : "Manual"}</p></div>
    <div className="flex items-center justify-between gap-3 sm:justify-end"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${run.notificationStatus === "sent" ? "bg-[#e6f4eb] text-[#177a55]" : run.status === "failed" || run.notificationStatus === "failed" ? "bg-[#fff0ed] text-[#b94d45]" : "bg-[#f1f4f1] text-[#728078]"}`}>{run.notificationStatus === "sent" ? "Correo enviado" : run.notificationStatus === "failed" ? "Correo fallido" : run.notificationStatus === "not_configured" ? "Correo sin configurar" : statusLabel(run.status)}</span>{run.results[0]?.amount != null && <span className="text-sm font-semibold text-[#29372f]">{formatObservedPrice(run.results[0].amount, run.results[0].currency)}</span>}</div>
    {hasDetails && <div className="sm:col-span-3"><button type="button" onClick={() => setExpanded((value) => !value)} className="text-xs font-semibold text-[#217c59]">{expanded ? "Ocultar detalles" : "Ver detalles"}</button>{expanded && <div className="mt-2 space-y-2 rounded-xl bg-[#f7f9f6] p-3">
      {snapshot && <div className="text-xs leading-5 text-[#58675e]"><p className="font-semibold">{snapshot.originIata} → {snapshot.destinationIata} · {snapshot.tripType === "round_trip" ? "Ida y vuelta" : "Solo ida"}</p><p>Salida: {dateDescription(snapshot.outboundMode, snapshot.outboundStart, snapshot.outboundEnd)}</p>{snapshot.tripType === "round_trip" && snapshot.inboundMode && snapshot.inboundStart && <p>Regreso: {dateDescription(snapshot.inboundMode, snapshot.inboundStart, snapshot.inboundEnd)}</p>}<p>{snapshot.adults} adulto(s) · límite {formatCop(snapshot.maxPriceCop)} · {snapshot.status === "active" ? "seguimiento activo" : "seguimiento en pausa"}</p></div>}
      <p className="text-[11px] text-[#87938c]">Inicio: {formatDateTime(run.startedAt)} · Fin: {formatDateTime(run.finishedAt)}</p>
      {run.scheduledAt && <p className="text-[11px] text-[#87938c]">Hora programada: {formatDateTime(run.scheduledAt)} (Bogotá)</p>}
      {(run.notificationRecipient || run.notificationSentAt || run.notificationError) && <p className="text-xs text-[#58675e]">Correo: {run.notificationRecipient || "destinatario sin configurar"}{run.notificationSentAt ? ` · enviado ${formatDateTime(run.notificationSentAt)}` : ""}{run.notificationError ? ` · ${run.notificationError}` : ""}</p>}
      {run.results.map((result, index) => <p key={`${result.outboundDate}-${result.inboundDate}-${index}`} className="text-xs text-[#58675e]"><span className="font-semibold">{result.outboundDate}{result.inboundDate ? ` → ${result.inboundDate}` : ""}</span>{result.amount != null && <> · {formatObservedPrice(result.amount, result.currency)}</>}{result.meetsThreshold ? " · Cumple el límite" : ""}{result.details && <> · {result.details}</>}{result.observedText && <> · {result.observedText}</>}</p>)}
    </div>}</div>}
  </article>;
}
function statusLabel(status: string) {
  const map: Record<string, string> = { completed: "Revisión lista", completed_with_matches: "Con coincidencias", no_prices: "Sin precios visibles", failed: "Consulta fallida", skipped_overlap: "Horario omitido", running: "En curso" };
  return map[status] ?? status;
}

export default function Home() {
  const [page, setPage] = useState<PageKey>("overview");
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [runs, setRuns] = useState<RunWithResults[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticLog[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [vault, setVault] = useState<VaultState>({ configured: false, unlocked: false });
  const [runner, setRunner] = useState<{ running: boolean; currentLabel: string | null; startedAt: string | null }>({ running: false, currentLabel: null, startedAt: null });
  const [modal, setModal] = useState<FollowUp | null | false>(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [vaultKey, setVaultKey] = useState("");
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

  const refresh = useCallback(async (options?: { preserveSettingsDraft?: boolean }) => {
    try {
      const [followData, historyData, settingsData, runnerData, diagnosticData, emailJsData] = await Promise.all([
        requestJson<{ followUps: FollowUp[] }>("/api/follow-ups"),
        requestJson<{ runs: RunWithResults[] }>("/api/history"),
        requestJson<{ settings: AppSettings; vault: VaultState; unlocked: boolean }>("/api/settings"),
        requestJson<typeof runner>("/api/runner"),
        requestJson<{ logs: DiagnosticLog[] }>("/api/diagnostics"),
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
      setVault({ ...settingsData.vault, unlocked: settingsData.unlocked }); setRunner(runnerData); setDiagnostics(diagnosticData.logs);
    } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo cargar la app."); }
  }, []);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh({ preserveSettingsDraft: true }), 8000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 4200); return () => window.clearTimeout(timer); }, [toast]);

  const activeCount = followUps.filter((item) => item.status === "active").length;
  const matchRuns = runs.filter((run) => run.results.some((result) => result.meetsThreshold));
  const filteredFollowUps = useMemo(() => followUps.filter((item) => `${item.name} ${item.originIata} ${item.destinationIata}`.toLowerCase().includes(query.toLowerCase())), [followUps, query]);
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
      const response = await requestJson<VaultState>("/api/vault", { method: "POST", body: JSON.stringify({ action, passphrase: vaultKey }) });
      setVault(response); setVaultKey(""); setToast(action === "lock" ? "Bóveda bloqueada." : "Bóveda desbloqueada."); await refresh();
    } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo abrir la bóveda."); }
  }
  async function resetVaultAction() {
    const accepted = window.confirm("Se borrarán la clave maestra y las credenciales de correo cifradas. Tus seguimientos, horarios, destinatario e historial se conservarán. Después crearás una clave maestra nueva. ¿Continuar?");
    if (!accepted) return;
    try {
      await requestJson("/api/vault", { method: "POST", body: JSON.stringify({ action: "reset", confirmation: "RESTABLECER BÓVEDA" }) });
      setVaultKey(""); setEmailJsConfig({ serviceId: "", templateId: "", publicKey: "", privateKey: "" }); setEmailJsConfigured(false); setEmailJsPrivateKeyConfigured(false); setSettings((old) => ({ ...old, senderEmail: null }));
      await refresh(); setToast("Bóveda restablecida. Crea una clave maestra nueva y configura Gmail.");
    } catch (error) { setToast(error instanceof Error ? error.message : "No se pudo restablecer la bóveda."); }
  }
  async function testEmail() {
    setTestingEmail(true);
    try { await requestJson("/api/email/test", { method: "POST", body: "{}" }); setToast("Correo de prueba enviado."); }
    catch (error) { setToast(error instanceof Error ? error.message : "No se pudo enviar el correo de prueba."); }
    finally { setTestingEmail(false); }
  }

  const title = navItems.find((item) => item.key === page)?.title ?? "Resumen";
  const nextTime = settings.scheduleTimes.find((time) => time > new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date())) ?? settings.scheduleTimes[0];

  return <div className="min-h-screen text-[#1b2922]">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[246px] flex-col border-r border-[#e5eae3] bg-[#fbfcf9]/90 px-4 py-5 backdrop-blur-xl lg:flex">
      <div className="flex items-center gap-3 px-2"><span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#147a59] text-white shadow-sm"><Plane size={20} strokeWidth={2}/></span><div><p className="text-[17px] font-bold tracking-[-.05em]">vuela<span className="text-[#14805a]">.</span></p><p className="text-[10px] font-medium uppercase tracking-[.14em] text-[#99a39d]">price watcher</p></div></div>
      <div className="mt-10 px-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#a4aea7]">Espacio personal</div>
      <nav className="mt-3 grid gap-1">{navItems.map(({ key, title: itemTitle, icon: Icon }) => <button key={key} onClick={() => setPage(key)} className={`flex h-11 items-center gap-3 rounded-xl px-3 text-left text-[13px] font-medium transition ${page === key ? "bg-[#eaf3ec] text-[#176d4f]" : "text-[#738078] hover:bg-[#f1f5f0] hover:text-[#34443b]"}`}><Icon size={17} strokeWidth={1.8}/>{itemTitle}{key === "followups" && <span className="ml-auto rounded-md bg-white/75 px-2 py-0.5 text-[11px] text-[#77857d]">{followUps.length}</span>}</button>)}</nav>
      <div className="mt-auto rounded-2xl border border-[#e5ece5] bg-white p-4 card-shadow"><div className="flex items-center gap-2 text-xs font-semibold text-[#44544a]"><span className={`h-2 w-2 rounded-full ${runner.running ? "animate-pulse bg-[#d08b37]" : "bg-[#2da46b]"}`}/>{runner.running ? "Consulta en curso" : "Vigilancia activa"}</div><p className="mt-2 text-[11px] leading-5 text-[#849088]">{runner.running ? runner.currentLabel ?? "Procesando seguimientos…" : `Próxima revisión · ${nextTime ?? "sin horario"}`}</p><div className="mt-3 flex items-center gap-1 text-[10px] text-[#9aa59e]"><span className="h-1.5 w-1.5 rounded-full bg-[#68b688]"/> Ventana local · Bogotá</div></div>
    </aside>

    <main className="min-h-screen lg:pl-[246px]">
      <header className="sticky top-0 z-10 border-b border-[#e6ebe5]/80 bg-[#f8faf6]/80 px-5 py-3 backdrop-blur-xl sm:px-8 lg:px-10"><div className="mx-auto flex max-w-[1320px] items-center justify-between"><div className="flex items-center gap-3 lg:hidden"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#147a59] text-white"><Plane size={18}/></span><span className="font-bold tracking-[-.04em]">vuela.</span></div><div className="hidden lg:block"><p className="text-xs text-[#93a098]">Tu espacio <span className="px-1.5">/</span><span className="font-medium text-[#54635b]">{title}</span></p></div><div className="flex items-center gap-2.5"><span className="hidden items-center gap-1.5 rounded-full border border-[#e3e9e2] bg-white/70 px-3 py-1.5 text-[11px] font-medium text-[#6d7b72] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#31a56d]"/> {runner.running ? "Revisando vuelos" : "Scheduler conectado"}</span><button onClick={() => setPage("settings")} className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e1e7e0] bg-white text-xs font-semibold text-[#4f6759]">V</button></div></div></header>

      <div className="mx-auto max-w-[1320px] px-5 pb-12 pt-8 sm:px-8 lg:px-10 lg:pt-10">
        <div className="mb-7 flex gap-1 overflow-x-auto lg:hidden">{navItems.map(({ key, title: itemTitle, icon: Icon }) => <button key={key} onClick={() => setPage(key)} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${page === key ? "bg-[#e6f1e9] text-[#176d4f]" : "text-[#77837c]"}`}><Icon size={15}/>{itemTitle}</button>)}</div>

        {page === "overview" && <>
          {vault.configured && !vault.unlocked && <section role="alert" className="mb-6 flex flex-col gap-4 rounded-2xl border-2 border-[#b94d45] bg-[#fff0ed] p-4 shadow-md sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-start gap-3"><span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#b94d45] text-white"><LockKeyhole size={19}/></span><div><h2 className="font-bold text-[#8f302c]">La bóveda está bloqueada</h2><p className="mt-1 text-sm leading-5 text-[#773b37]">Las alertas de precio no podrán enviarse hasta que desbloquees la bóveda.</p></div></div>
            <button type="button" onClick={() => setPage("settings")} className="focus-ring shrink-0 rounded-xl bg-[#a83d38] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#8f302c]">Desbloquear bóveda</button>
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
          <section className="mt-10"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-[19px] font-semibold tracking-[-.035em]">Actividad reciente</h2><p className="mt-1 text-xs text-[#8b9790]">Precios consultados y avisos enviados.</p></div><button onClick={() => setPage("history")} className="inline-flex items-center gap-1 text-xs font-semibold text-[#217c59]">Ver historial <ArrowRight size={14}/></button></div><div className="card-shadow rounded-[18px] border border-[#e6ebe5] bg-white px-5">{runs.slice(0, 4).length ? runs.slice(0, 4).map((run) => <HistoryRow key={run.id} run={run}/>) : <div className="py-9 text-center text-sm text-[#8d9992]">Todavía no hay consultas. Tus ejecuciones aparecerán aquí.</div>}</div></section>
        </>}

        {page === "followups" && <>
          <PageHeading eyebrow="Rutas guardadas" title="Seguimientos" description="Administra tus rutas y define cuándo recibir una alerta." action={<PrimaryButton onClick={() => setModal(null)}><Plus size={16}/> Nuevo seguimiento</PrimaryButton>}/>
          <div className="mb-5 mt-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="relative max-w-sm flex-1"><Search size={16} className="absolute left-3.5 top-3.5 text-[#9aa59e]"/><input className={`${inputClass} pl-10`} placeholder="Buscar por ruta o nombre…" value={query} onChange={(e) => setQuery(e.target.value)}/></div><span className="text-xs text-[#87938c]">{activeCount} activos · {followUps.length - activeCount} en pausa</span></div>
          {filteredFollowUps.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredFollowUps.map((item) => <FollowUpCard key={item.id} followUp={item} onEdit={() => setModal(item)} onToggle={() => void toggleStatus(item)} onDelete={() => void deleteItem(item)} onRun={() => void runNow(item.id)} running={runner.running || busy}/>)}</div> : <EmptyState onCreate={() => setModal(null)}/>}
        </>}

        {page === "history" && <>
          <PageHeading eyebrow="Últimos movimientos" title="Historial" description={`Consultas y alertas guardadas durante los últimos ${settings.historyRetentionDays} días.`} action={<button onClick={() => void refresh()} className="focus-ring flex h-10 items-center gap-2 rounded-xl border border-[#dfe7df] bg-white px-3 text-sm font-medium text-[#65746b]"><RefreshCw size={14}/> Actualizar</button>}/>
          <div className="mt-7 grid gap-3 sm:grid-cols-3"><MiniStat label="Ejecuciones" value={filteredRuns.length}/><MiniStat label="Alertas de precio" value={filteredRuns.filter((run) => run.results.some((result) => result.meetsThreshold)).length}/><MiniStat label="Fallos registrados" value={filteredRuns.filter((run) => run.status === "failed").length}/></div>
          <div className="card-shadow mt-5 rounded-[18px] border border-[#e6ebe5] bg-white px-5">
            <div className="grid gap-3 border-b border-[#edf0ed] py-4 sm:grid-cols-3 sm:items-end">
              <label className="grid gap-1.5 text-xs font-medium text-[#56655c]"><span>Seguimiento</span><select aria-label="Filtrar historial por seguimiento" className={`${inputClass} h-10`} value={historyFollowUpId} onChange={(event) => setHistoryFollowUpId(event.target.value)}><option value="">Todos</option>{historyFollowUps.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <label className="grid gap-1.5 text-xs font-medium text-[#56655c]"><span>Desde</span><input aria-label="Historial desde" type="date" className={`${inputClass} h-10`} value={historyFrom} max={historyTo || undefined} onChange={(event) => setHistoryFrom(event.target.value)}/></label>
              <label className="grid gap-1.5 text-xs font-medium text-[#56655c]"><span>Hasta</span><input aria-label="Historial hasta" type="date" className={`${inputClass} h-10`} value={historyTo} min={historyFrom || undefined} onChange={(event) => setHistoryTo(event.target.value)}/></label>
            </div>
            <div className="flex items-center justify-between border-b border-[#edf0ed] py-4"><h2 className="text-sm font-semibold">Ejecuciones</h2><span className="text-[11px] text-[#929d96]">{filteredRuns.length} · Más recientes primero</span></div>
            {filteredRuns.length ? filteredRuns.map((run) => <HistoryRow key={run.id} run={run}/>) : <div className="py-14 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f1f5f0] text-[#8a9990]"><History size={20}/></span><p className="mt-3 text-sm font-semibold text-[#47574d]">{runs.length ? "No hay ejecuciones para estos filtros" : "Tu historial está tranquilo"}</p><p className="mt-1 text-xs text-[#8c9891]">{runs.length ? "Cambia el seguimiento o las fechas para ver más resultados." : "Las ejecuciones y alertas aparecerán aquí."}</p></div>}
          </div>
        </>}

        {page === "diagnostics" && <>
          <PageHeading eyebrow="Registro local" title="Diagnóstico" description="Pasos y errores recientes de configuración, Gmail, seguimientos y consultas. Las contraseñas y tokens no se guardan aquí." action={<button onClick={() => void refresh()} className="focus-ring flex h-10 items-center gap-2 rounded-xl border border-[#dfe7df] bg-white px-3 text-sm font-medium text-[#65746b]"><RefreshCw size={14}/> Actualizar</button>}/>
          <div className="card-shadow mt-7 rounded-[18px] border border-[#e6ebe5] bg-white px-5">
            <div className="flex items-center justify-between border-b border-[#edf0ed] py-4"><h2 className="text-sm font-semibold">Eventos recientes</h2><span className="text-[11px] text-[#929d96]">{diagnostics.length} · más recientes primero</span></div>
            {diagnostics.length ? diagnostics.map((entry) => <article key={entry.id} className="grid gap-2 border-b border-[#edf0ed] py-4 last:border-0 sm:grid-cols-[145px_1fr]"><div><p className="text-xs font-semibold text-[#4c5b52]">{entry.area} · {entry.event}</p><p className="mt-1 text-[11px] text-[#8c9891]">{formatDateTime(entry.createdAt)}</p></div><div className="flex items-start gap-2"><span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${entry.outcome === "success" ? "bg-[#e8f4ec] text-[#177b55]" : entry.outcome === "error" ? "bg-[#fff0ed] text-[#b94d45]" : entry.outcome === "warning" ? "bg-[#fff3e4] text-[#a86b21]" : "bg-[#f1f4f1] text-[#728078]"}`}>{entry.outcome === "success" ? "Correcto" : entry.outcome === "error" ? "Error" : entry.outcome === "warning" ? "Aviso" : "Info"}</span><p className="text-xs leading-5 text-[#58675e]">{entry.message}</p></div></article>) : <div className="py-14 text-center text-sm text-[#8c9891]">Todavía no hay eventos. Los pasos de configuración y tus pruebas aparecerán aquí.</div>}
          </div>
        </>}

        {page === "settings" && <>
          <PageHeading eyebrow="Preferencias de la app" title="Configuración" description="Horarios, destinatario y servicio de envío de correos."/>
          <div className="mt-7 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
            <form onSubmit={saveAppSettings} className="card-shadow rounded-[20px] border border-[#e6ebe5] bg-white p-5 sm:p-6">
              <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f4ec] text-[#18805a]"><Clock3 size={18}/></span><div><h2 className="font-semibold">Revisiones diarias</h2><p className="mt-1 text-xs leading-5 text-[#87938c]">Todos los horarios se calculan en la zona horaria de Bogotá.</p></div></div>
              <div className="mt-5"><p className="text-xs font-semibold text-[#56655c]">Horas de consulta</p><div className="mt-2 flex flex-wrap gap-2">{settings.scheduleTimes.map((time, index) => <div key={`${time}-${index}`} className="flex items-center gap-1 rounded-xl border border-[#e1e8e1] bg-[#fbfcfa] p-1"><input aria-label={`Horario ${index + 1}`} type="time" className="h-9 w-[108px] bg-transparent px-2 text-sm font-medium text-[#425248] outline-none" value={time} onChange={(event) => setSettings((old) => ({ ...old, scheduleTimes: old.scheduleTimes.map((item, i) => i === index ? event.target.value : item) }))}/><IconButton label="Quitar horario" onClick={() => setSettings((old) => ({ ...old, scheduleTimes: old.scheduleTimes.filter((_, i) => i !== index) }))}><X size={14}/></IconButton></div>)}<button type="button" onClick={() => setSettings((old) => ({ ...old, scheduleTimes: [...old.scheduleTimes, "18:00"].slice(0, 12) }))} className="flex h-11 items-center gap-1.5 rounded-xl border border-dashed border-[#cbd9ce] px-3 text-xs font-semibold text-[#217c59] hover:bg-[#f4f8f3]"><Plus size={14}/> Añadir hora</button></div></div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Correo destinatario"><input className={inputClass} type="email" value={settings.recipientEmail} placeholder="tu-correo@hotmail.com" onChange={(event) => setSettings((old) => ({ ...old, recipientEmail: event.target.value }))}/></Field><Field label="Retención de historial" hint="Los registros anteriores se limpian automáticamente."><div className="relative"><input className={`${inputClass} pr-16`} type="number" min={1} max={3650} value={settings.historyRetentionDays} onChange={(event) => setSettings((old) => ({ ...old, historyRetentionDays: Number(event.target.value) }))}/><span className="absolute right-3 top-3 text-xs text-[#89958e]">días</span></div></Field></div>
              <div className="mt-5 flex items-center justify-between rounded-xl bg-[#f7f9f6] px-3.5 py-3"><div><p className="text-sm font-medium">Automatización programada</p><p className="mt-0.5 text-xs text-[#859189]">El proceso debe seguir abierto para ejecutar.</p></div><button type="button" role="switch" aria-checked={settings.schedulerEnabled} onClick={() => setSettings((old) => ({ ...old, schedulerEnabled: !old.schedulerEnabled }))} className={`relative h-6 w-11 rounded-full transition ${settings.schedulerEnabled ? "bg-[#18805d]" : "bg-[#c7d0c9]"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${settings.schedulerEnabled ? "left-6" : "left-1"}`}/></button></div>
              {settingsSaved && <p className="mt-3 flex items-center gap-1.5 text-xs text-[#178057]"><Check size={14}/> Configuración guardada</p>}
              <div className="mt-5 flex justify-end"><PrimaryButton type="submit" disabled={savingSettings || settings.scheduleTimes.length === 0}>{savingSettings ? "Guardando…" : "Guardar configuración"}</PrimaryButton></div>
            </form>

            <div className="grid content-start gap-5">
              <form onSubmit={saveEmailJsSettings} className="card-shadow rounded-[20px] border border-[#e6ebe5] bg-white p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eef1fb] text-[#5c69a9]"><Mail size={18}/></span><div><h2 className="font-semibold">Envío por EmailJS</h2><p className="mt-1 text-xs leading-5 text-[#87938c]">Conecta tu Gmail desde EmailJS. Vuela envía por HTTPS y conserva las claves en la bóveda cifrada.</p></div></div>
                <div className="mt-4 grid gap-3"><Field label="Service ID"><input className={inputClass} value={emailJsConfig.serviceId} placeholder="service_..." autoComplete="off" disabled={!vault.unlocked} onChange={(event) => setEmailJsConfig((old) => ({ ...old, serviceId: event.target.value }))}/></Field><Field label="Template ID"><input className={inputClass} value={emailJsConfig.templateId} placeholder="template_..." autoComplete="off" disabled={!vault.unlocked} onChange={(event) => setEmailJsConfig((old) => ({ ...old, templateId: event.target.value }))}/></Field><Field label="Public Key"><input className={inputClass} value={emailJsConfig.publicKey} placeholder="Public Key de Account" autoComplete="off" disabled={!vault.unlocked} onChange={(event) => setEmailJsConfig((old) => ({ ...old, publicKey: event.target.value }))}/></Field><Field label="Private Key (opcional)" hint="Se cifra en la bóveda. Si ya está guardada y lo dejas vacío, se conserva."><input className={inputClass} type="password" autoComplete="new-password" value={emailJsConfig.privateKey} placeholder={emailJsPrivateKeyConfigured ? "Private Key guardada" : "Opcional; puedes dejarla vacía"} disabled={!vault.unlocked} onChange={(event) => setEmailJsConfig((old) => ({ ...old, privateKey: event.target.value }))}/></Field></div>
                <div className="mt-4 flex flex-wrap items-center gap-2"><PrimaryButton type="submit" disabled={savingEmailJs || !vault.unlocked}>{savingEmailJs ? "Guardando…" : "Guardar EmailJS"}</PrimaryButton><span className={"rounded-full px-2.5 py-1 text-[10px] font-semibold " + (emailJsConfigured ? "bg-[#e8f4ec] text-[#177b55]" : "bg-[#f2f4f1] text-[#7d8981]")}>{emailJsConfigured ? "Configurado" : "Sin configurar"}</span></div>
                <div className="mt-3 flex flex-wrap items-center gap-2"><PrimaryButton onClick={() => void testEmail()} disabled={testingEmail || !emailJsConfigured || !settings.recipientEmail || !vault.unlocked}><Mail size={14}/>{testingEmail ? "Enviando…" : "Enviar correo de prueba"}</PrimaryButton><p className="text-xs text-[#78867d]">La prueba se envía al correo destinatario configurado.</p></div>
                {!vault.unlocked && <p className="mt-3 text-[11px] leading-5 text-[#a16d2c]">Desbloquea la bóveda para configurar EmailJS.</p>}
              </form>

              <section className="card-shadow rounded-[20px] border border-[#e6ebe5] bg-white p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff3e6] text-[#b4772a]"><ShieldCheck size={18}/></span><div><h2 className="font-semibold">Bóveda local cifrada</h2><p className="mt-1 text-xs leading-5 text-[#87938c]">Las claves de EmailJS se cifran en el archivo local. La clave maestra solo permanece en memoria mientras está desbloqueada.</p></div></div>
                <div className="mt-4 flex gap-2"><div className="relative min-w-0 flex-1"><input className={`${inputClass} pr-11`} type={showVaultKey ? "text" : "password"} autoComplete={vault.configured ? "current-password" : "new-password"} value={vaultKey} placeholder={vault.configured ? "Clave maestra" : "Crea una clave de 12+ caracteres"} onChange={(event) => setVaultKey(event.target.value)}/><button type="button" aria-label={showVaultKey ? "Ocultar clave maestra" : "Mostrar clave maestra"} onClick={() => setShowVaultKey((value) => !value)} className="absolute right-2 top-2.5 rounded-lg p-1.5 text-[#79867f] hover:bg-[#f1f5f1]">{showVaultKey ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>{!vault.configured ? <button onClick={() => void vaultAction("setup")} className="focus-ring shrink-0 rounded-xl bg-[#273c30] px-3 text-xs font-semibold text-white">Crear bóveda</button> : vault.unlocked ? <button onClick={() => void vaultAction("lock")} className="focus-ring shrink-0 rounded-xl border border-[#e1e7e1] px-3 text-xs font-semibold text-[#54645a]">Bloquear</button> : <button onClick={() => void vaultAction("unlock")} className="focus-ring shrink-0 rounded-xl bg-[#273c30] px-3 text-xs font-semibold text-white">Desbloquear</button>}</div>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#859189]"><LockKeyhole size={13}/>{vault.unlocked ? "Bóveda desbloqueada en memoria" : vault.configured ? "Bóveda bloqueada" : "Aún no configurada"}</div>
                {vault.configured && !vault.unlocked && <button type="button" onClick={() => void resetVaultAction()} className="mt-3 text-[11px] font-semibold text-[#a44940] underline underline-offset-2">Olvidé la clave maestra · Restablecer bóveda</button>}
              </section>

            </div>
          </div>
        </>}
      </div>
    </main>
    {modal !== false && <FollowUpModal initial={modal} onClose={() => setModal(false)} onSave={saveFollowUp}/>}
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
