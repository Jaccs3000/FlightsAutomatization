import { randomUUID } from "node:crypto";
import { createRun, finishRun, getSettings, listFollowUps, setRunNotification } from "./db";
import { sendPriceAlert } from "./email";
import { scanGoogleFlights } from "./google-flights";
import { meetsCopThreshold } from "./prices";
import { isVaultUnlocked } from "./vault";
import { emailJsConfigured } from "./emailjs";
import { errorSummary, logDiagnostic } from "./diagnostics";
import type { FollowUp, RunRecord, RunStatus } from "./types";

export interface RunnerState {
  running: boolean; currentBatchId: string | null; currentFollowUpId: string | null;
  currentLabel: string | null; startedAt: string | null; lastStartedAt: string | null;
  lastFinishedAt: string | null; lastError: string | null;
}

const state: RunnerState = { running: false, currentBatchId: null, currentFollowUpId: null, currentLabel: null, startedAt: null, lastStartedAt: null, lastFinishedAt: null, lastError: null };
const listeners = new Set<() => void>();
let activePromise: Promise<{ batchId: string; skipped: boolean }> | null = null;

function publish() { for (const listener of listeners) listener(); }
export function runnerState() { return { ...state }; }
export function subscribeRunner(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function isRunnerBusy() { return activePromise !== null; }

async function runOne(followUp: FollowUp, batchId: string, runType: "scheduled" | "manual", scheduledAt?: string) {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  state.currentFollowUpId = followUp.id;
  state.currentLabel = followUp.name;
  publish();
  await createRun({ id, batchId, followUp, runType, scheduledAt, startedAt });
  await logDiagnostic("Google Flights", runType === "scheduled" ? "Consulta programada" : "Consulta manual", "info", `Consulta iniciada para ruta ${followUp.originIata} → ${followUp.destinationIata}.`);
  try {
    const allResults = await scanGoogleFlights(followUp);
    const results = allResults.map((item) => ({ ...item, meetsThreshold: meetsCopThreshold(item, followUp.maxPriceCop) }));
    const matches = results.filter((item) => item.meetsThreshold);
    await logDiagnostic("Google Flights", "Lectura de precios", results.length ? "success" : "warning", `Leídos ${results.length} precios; ${matches.length} cumplen el límite configurado.`);
    const settings = await getSettings();
    let notificationStatus: RunRecord["notificationStatus"] = "not_needed";
    let error: string | null = null;
    let status: RunStatus = results.length === 0 ? "no_prices" : matches.length ? "completed_with_matches" : "completed";
    if (matches.length) {
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
        try {
          await sendPriceAlert({ recipient: settings.recipientEmail, followUp, results: matches, runTime: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }) });
          notificationStatus = "sent";
          await setRunNotification(id, "sent", settings.recipientEmail);
          await logDiagnostic("EmailJS", "Enviar alerta", "success", `Alerta enviada con ${matches.length} resultado(s) que cumplen el límite.`);
        } catch (caught) {
          notificationStatus = "failed";
          error = caught instanceof Error ? caught.message : "Falló el envío del correo.";
          await setRunNotification(id, "failed", settings.recipientEmail, error);
          await logDiagnostic("EmailJS", "Enviar alerta", "error", errorSummary(caught));
        }
      }
    }
    await finishRun({ id, status, finishedAt: new Date().toISOString(), error, results, notificationStatus });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Falló la consulta de Google Flights.";
    state.lastError = message;
    await logDiagnostic("Google Flights", "Consulta", "error", errorSummary(caught));
    await finishRun({ id, status: "failed", finishedAt: new Date().toISOString(), error: message, results: [], notificationStatus: "not_needed" });
  } finally { state.currentFollowUpId = null; state.currentLabel = null; publish(); }
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
      state.running = false; state.currentBatchId = null; state.startedAt = null; state.currentFollowUpId = null; state.currentLabel = null; state.lastFinishedAt = new Date().toISOString(); activePromise = null; publish();
    }
  })();
  return activePromise;
}
