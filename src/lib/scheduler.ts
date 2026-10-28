import { addSkippedRun, getSettings, listFollowUps, pruneHistory } from "./db";
import { isRunnerBusy, runScheduledBatch } from "./runner";

let timer: ReturnType<typeof setInterval> | null = null;
let lastMinuteKey = "";
let lastPruneDate = "";

function bogotaNow() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function scheduledTimestamp(date: string, time: string) {
  return new Date(`${date}T${time}:00-05:00`).toISOString();
}

export async function tickScheduler() {
  const { date, time } = bogotaNow();
  const key = `${date}T${time}`;
  if (key === lastMinuteKey) return;
  const settings = await getSettings();
  if (lastPruneDate !== date) {
    try { await pruneHistory(settings.historyRetentionDays); lastPruneDate = date; }
    catch (error) { console.error("History cleanup:", error instanceof Error ? error.message : error); }
  }
  lastMinuteKey = key;
  if (!settings.schedulerEnabled || !settings.scheduleTimes.includes(time)) return;
  if (isRunnerBusy()) {
    const batchId = `skipped-${Date.now()}`;
    for (const followUp of (await listFollowUps()).filter((item) => item.status === "active")) {
      await addSkippedRun({ batchId, followUp, scheduledAt: scheduledTimestamp(date, time), startedAt: new Date().toISOString(), reason: `Se omitió ${time}: la ejecución anterior seguía activa.` });
    }
    return;
  }
  await runScheduledBatch(scheduledTimestamp(date, time));
}

export async function startScheduler() {
  if (timer) return;
  await pruneHistory((await getSettings()).historyRetentionDays);
  lastPruneDate = bogotaNow().date;
  timer = setInterval(() => { void tickScheduler().catch((error) => console.error("Scheduler:", error instanceof Error ? error.message : error)); }, 15_000);
  timer.unref?.();
}

export function stopScheduler() { if (timer) clearInterval(timer); timer = null; }
