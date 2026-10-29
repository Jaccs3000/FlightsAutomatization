import { randomUUID } from "node:crypto";
import { cancelRun, createRun, finishRun, getSettings, listFollowUps, setRunNotification } from "./db";
import { sendPriceAlert } from "./email";
import { scanGoogleFlights, stopGoogleFlightsRun } from "./google-flights";
import type { SearchProgress } from "./google-flights";
import { meetsCopThreshold } from "./prices";
import { isVaultUnlocked } from "./vault";
import { emailJsConfigured } from "./emailjs";
import { errorSummary, logDiagnostic } from "./diagnostics";
import type { FollowUp, RunRecord, RunStatus } from "./types";

export interface RunnerState {
  running: boolean; currentBatchId: string | null; currentFollowUpId: string | null;
  currentLabel: string | null; currentRunId: string | null; progress: SearchProgress | null; startedAt: string | null; lastStartedAt: string | null;
  lastFinishedAt: string | null; lastError: string | null;
}

type RunControl = { cancelled: boolean; settled: Promise<void>; settle: () => void };
type BatchPromise = Promise<{ batchId: string; skipped: boolean }>;
type RunnerGlobal = typeof globalThis & {
  __vuelaRunControls?: Map<string, RunControl>;
  __vuelaRunnerState?: RunnerState;
  __vuelaRunnerListeners?: Set<() => void>;
  __vuelaActivePromise?: BatchPromise | null;
};
const runnerGlobal = globalThis as RunnerGlobal;
const runControls = runnerGlobal.__vuelaRunControls ??= new Map<string, RunControl>();
const state = runnerGlobal.__vuelaRunnerState ??= { running: false, currentBatchId: null, currentFollowUpId: null, currentLabel: null, currentRunId: null, progress: null, startedAt: null, lastStartedAt: null, lastFinishedAt: null, lastError: null };
const listeners = runnerGlobal.__vuelaRunnerListeners ??= new Set<() => void>();
let activePromise = runnerGlobal.__vuelaActivePromise ?? null;

function publish() { for (const listener of listeners) listener(); }
export function runnerState() { return { ...state }; }
export function subscribeRunner(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function isRunnerBusy() { return activePromise !== null; }

async function runOne(followUp: FollowUp, batchId: string, runType: "scheduled" | "manual", scheduledAt?: string) {
  const id = randomUUID();
  const runKey = id.slice(0, 12);
  const startedClock = performance.now();
  let scanStartedClock = 0;
  let scanDurationMs: number | null = null;
  let stageStartedClock = startedClock;
  let lastProgressLogClock = startedClock;
  let lastProgressLogCount = 0;
  let latestProgressCount = 0;
  let latestProgressTotal = 0;
  let loggedPhase: string | null = null;
  let terminalStatus = "failed";
  let finalResultCount = 0;
  let finalMatchCount = 0;
  let settle!: () => void;
  const control: RunControl = { cancelled: false, settled: new Promise<void>((resolve) => { settle = resolve; }), settle: () => settle() };
  runControls.set(id, control);
  const startedAt = new Date().toISOString();
  state.currentFollowUpId = followUp.id;
  state.currentLabel = followUp.name;
  state.currentRunId = id;
  state.progress = null;
  publish();
  try {
  await createRun({ id, batchId, followUp, runType, scheduledAt, startedAt });
  await logDiagnostic("Google Flights", runType === "scheduled" ? "Consulta programada" : "Consulta manual", "info", `Consulta iniciada para ${followUp.originIata} → ${(followUp.destinationIatas ?? [followUp.destinationIata]).join(", ")}.`);
    await logDiagnostic("Rendimiento", "Ejecución iniciada", "info", `run ${runKey}; seguimiento ${followUp.id.slice(0, 12)}; tipo=${runType}; ruta=${followUp.originIata} a ${(followUp.destinationIatas ?? [followUp.destinationIata]).join(",")}.`);
    scanStartedClock = performance.now();
    const allResults = await scanGoogleFlights(followUp, id, (progress) => {
      const now = performance.now();
      state.progress = progress;
      publish();
      if (progress.phase !== loggedPhase) {
        if (loggedPhase) void logDiagnostic("Rendimiento", "Etapa completada", "info", `run ${runKey}; etapa=${loggedPhase}; duración=${((now - stageStartedClock) / 1000).toFixed(1)}s; avance=${latestProgressCount}/${latestProgressTotal}.`);
        loggedPhase = progress.phase;
        stageStartedClock = now;
        lastProgressLogClock = now;
        lastProgressLogCount = progress.completed;
        latestProgressCount = progress.completed;
        latestProgressTotal = progress.total;
        void logDiagnostic("Rendimiento", "Etapa iniciada", "info", `run ${runKey}; etapa=${progress.phase}; total=${progress.total}; actual=${progress.current ?? "—"}.`);
        return;
      }
      latestProgressCount = progress.completed;
      latestProgressTotal = progress.total;
      const countStep = Math.max(10, Math.ceil(progress.total / 10));
      if (progress.completed === progress.total || now - lastProgressLogClock >= 30_000 || progress.completed - lastProgressLogCount >= countStep) {
        lastProgressLogClock = now;
        lastProgressLogCount = progress.completed;
        void logDiagnostic("Rendimiento", "Avance", "info", `run ${runKey}; etapa=${progress.phase}; avance=${progress.completed}/${progress.total}; etapa=${((now - stageStartedClock) / 1000).toFixed(1)}s; total=${((now - startedClock) / 1000).toFixed(1)}s; actual=${progress.current ?? "—"}.`);
      }
    });
    scanDurationMs = Math.round(performance.now() - scanStartedClock);
    if (control.cancelled) throw new Error("run_cancelled");
    const results = allResults.map((item) => ({ ...item, meetsThreshold: item.isCalendarMinimum || item.flightDetailsStatus === "no_matching_flights" ? false : meetsCopThreshold(item, followUp.maxPriceCop) }));
    const matches = results.filter((item) => item.meetsThreshold);
    finalResultCount = results.length;
    finalMatchCount = matches.length;
    await logDiagnostic("Google Flights", "Lectura de precios", results.length ? "success" : "warning", `Leídos ${results.length} precios; ${matches.length} cumplen el límite configurado.`);
    const settings = await getSettings();
    let notificationStatus: RunRecord["notificationStatus"] = "not_needed";
    let error: string | null = null;
    let status: RunStatus = results.length === 0 ? "no_prices" : matches.length ? "completed_with_matches" : "completed";
    terminalStatus = status;
    if (matches.length) {
      if (control.cancelled) throw new Error("run_cancelled");
      if (!settings.recipientEmail) {
        notificationStatus = "not_configured"; error = "Hay resultados bajo el límite, pero falta el destinatario del correo.";
        await setRunNotification(id, notificationStatus, "", error);
        await logDiagnostic("EmailJS", "Enviar alerta", "error", "Hay coincidencias, pero falta el destinatario.");
      }
      else if (!isVaultUnlocked()) {
        notificationStatus = "failed"; error = "Hay resultados bajo el límite, pero la bóveda está bloqueada.";
        await setRunNotification(id, notificationStatus, settings.recipientEmail, error);
        await logDiagnostic("EmailJS", "Enviar alerta", "error", "Hay coincidencias, pero la bóveda está bloqueada.");
      }
      else if (!await emailJsConfigured()) {
        notificationStatus = "not_configured"; error = "Hay resultados bajo el límite, pero EmailJS no está configurado.";
        await setRunNotification(id, notificationStatus, settings.recipientEmail, error);
        await logDiagnostic("EmailJS", "Enviar alerta", "error", "Hay coincidencias, pero EmailJS no está configurado.");
      }
      else {
        const emailStartedClock = performance.now();
        try {
          await sendPriceAlert({ recipient: settings.recipientEmail, followUp, results: matches, runTime: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }) });
          notificationStatus = "sent";
          void logDiagnostic("Rendimiento", "Correo enviado", "success", `run ${runKey}; duración=${((performance.now() - emailStartedClock) / 1000).toFixed(1)}s; resultados=${matches.length}.`);
          await setRunNotification(id, "sent", settings.recipientEmail);
          await logDiagnostic("EmailJS", "Enviar alerta", "success", `Alerta enviada con ${matches.length} resultado(s) que cumplen el límite.`);
        } catch (caught) {
          notificationStatus = "failed";
          error = caught instanceof Error ? caught.message : "Falló el envío del correo.";
          void logDiagnostic("Rendimiento", "Correo fallido", "warning", `run ${runKey}; duración=${((performance.now() - emailStartedClock) / 1000).toFixed(1)}s; error=${errorSummary(caught)}.`);
          await setRunNotification(id, "failed", settings.recipientEmail, error);
          await logDiagnostic("EmailJS", "Enviar alerta", "error", errorSummary(caught));
        }
      }
    }
    if (control.cancelled) {
      terminalStatus = "cancelled";
      await finishRun({ id, status: "cancelled", finishedAt: new Date().toISOString(), error: "Ejecución detenida por el usuario.", results: [], notificationStatus: "not_needed" });
    } else await finishRun({ id, status, finishedAt: new Date().toISOString(), error, results, notificationStatus });
  } catch (caught) {
    if (control.cancelled) {
      terminalStatus = "cancelled";
      const message = "Ejecución detenida por el usuario.";
      await logDiagnostic("Rendimiento", "Ejecución cancelada", "warning", `run ${runKey}; transcurrido=${((performance.now() - startedClock) / 1000).toFixed(1)}s.`);
      await logDiagnostic("Ejecución", "Detención manual", "info", `${followUp.name}: ${message}`);
      await finishRun({ id, status: "cancelled", finishedAt: new Date().toISOString(), error: message, results: [], notificationStatus: "not_needed" });
    } else {
    terminalStatus = "failed";
    const message = caught instanceof Error ? caught.message : "Falló la consulta de Google Flights.";
    state.lastError = message;
    await logDiagnostic("Rendimiento", "Ejecución fallida", "error", `run ${runKey}; transcurrido=${((performance.now() - startedClock) / 1000).toFixed(1)}s; error=${errorSummary(caught)}.`);
    await logDiagnostic("Google Flights", "Consulta", "error", errorSummary(caught));
    await finishRun({ id, status: "failed", finishedAt: new Date().toISOString(), error: message, results: [], notificationStatus: "not_needed" });
    }
  } finally {
    if (loggedPhase) await logDiagnostic("Rendimiento", "Etapa completada", "info", `run ${runKey}; etapa=${loggedPhase}; duración=${((performance.now() - stageStartedClock) / 1000).toFixed(1)}s; avance=${latestProgressCount}/${latestProgressTotal}.`);
    await logDiagnostic("Rendimiento", "Ejecución finalizada", terminalStatus === "failed" ? "error" : terminalStatus === "cancelled" ? "warning" : "success", `run ${runKey}; seguimiento ${followUp.id.slice(0, 12)}; estado=${terminalStatus}; precios=${finalResultCount}; bajo_limite=${finalMatchCount}; búsqueda=${scanDurationMs === null ? "no iniciada" : `${(scanDurationMs / 1000).toFixed(1)}s`}; total=${((performance.now() - startedClock) / 1000).toFixed(1)}s.`);
    runControls.delete(id); control.settle(); state.currentFollowUpId = null; state.currentLabel = null; state.currentRunId = null; state.progress = null; publish();
  }
}

export async function stopRun(id: string): Promise<boolean> {
  const control = runControls.get(id);
  if (control) {
    control.cancelled = true;
    await stopGoogleFlightsRun(id);
    await control.settled;
    return true;
  }
  return cancelRun(id);
}

export function runFollowUpNow(id: string) { return startBatch("manual", id); }
export function runAllNow() { return startBatch("manual"); }
export function runScheduledBatch(scheduledAt?: string) { return startBatch("scheduled", undefined, scheduledAt); }

async function startBatch(type: "manual" | "scheduled", followUpId?: string, scheduledAt?: string): Promise<{ batchId: string; skipped: boolean }> {
  if (activePromise) return { batchId: state.currentBatchId ?? "", skipped: true };
  const batchId = randomUUID();
  const startedAt = new Date().toISOString();
  state.running = true; state.currentBatchId = batchId; state.startedAt = startedAt; state.lastStartedAt = startedAt; state.lastError = null; publish();
  activePromise = (async () => {
    try {
      let followUps = await listFollowUps();
      followUps = type === "manual" && followUpId ? followUps.filter((item) => item.id === followUpId) : followUps.filter((item) => item.status === "active");
      for (const followUp of followUps) await runOne(followUp, batchId, type, scheduledAt);
      return { batchId, skipped: false };
    } finally {
      state.running = false; state.currentBatchId = null; state.startedAt = null; state.currentFollowUpId = null; state.currentLabel = null; state.currentRunId = null; state.progress = null; state.lastFinishedAt = new Date().toISOString(); activePromise = null; runnerGlobal.__vuelaActivePromise = null; publish();
    }
  })();
  runnerGlobal.__vuelaActivePromise = activePromise;
  return activePromise;
}
