import { chromium, type Browser, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FlightPriceResult, FollowUp } from "./types";
import { dateRange, daysBetween, validRoundTripPairs, weekendEscapeCandidates } from "./dates";
import { parsePrice } from "./prices";
import { parseGoogleFlightCard } from "./google-flights-parser";
import type { FlightItineraryOption } from "./types";
import { logDiagnostic } from "./diagnostics";
import { calendarDateTextMatches } from "./google-flights-date-match";

type FlightBrowserGlobal = typeof globalThis & { __vuelaFlightBrowsers?: Map<string, Browser>; __vuelaStoppedRunIds?: Set<string> };
const flightGlobal = globalThis as FlightBrowserGlobal;
const flightBrowsers = flightGlobal.__vuelaFlightBrowsers ??= new Map<string, Browser>();
const stoppedRunIds = flightGlobal.__vuelaStoppedRunIds ??= new Set<string>();

export type SearchProgress = {
  phase: string;
  completed: number;
  total: number;
  current?: string;
  destinationProgress?: Array<{ destinationIata: string; completed: number; total: number }>;
};
export type SearchProgressCallback = (progress: SearchProgress) => void;

type RunScreenshotContext = { runId?: string; directory: string; sequence: number; manifest: Array<{ file: string; label: string; capturedAt: string; url: string }> };

async function logFlightStep(context: RunScreenshotContext | null | undefined, event: string, outcome: "info" | "success" | "warning" | "error", data: Record<string, unknown>) {
  const payload = JSON.stringify({ runId: context?.runId ?? null, at: new Date().toISOString(), ...data });
  console.info(`[GoogleFlights] ${event} ${payload}`);
  await logDiagnostic("Google Flights", event, outcome, payload);
}

async function dateControlSnapshot(page: Page) {
  // Google alternates between native inputs and compact date buttons. Keep the
  // snapshot limited to the search form (never calendar day cells).
  return page.locator("input, button, [role='button'], [role='textbox']").evaluateAll((nodes) => nodes
    .map((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      const dialog = element.closest("[role='dialog']");
      const dialogRect = dialog?.getBoundingClientRect();
      return {
        placeholder: element.getAttribute("placeholder") ?? "",
        label: element.getAttribute("aria-label") ?? "",
        title: element.getAttribute("title") ?? "",
        value: (element as HTMLInputElement).value ?? "",
        text: (element.innerText ?? element.textContent ?? "").trim(),
        inDialog: Boolean(dialog),
        inDialogHeader: Boolean(dialogRect && rect.top >= dialogRect.top && rect.top < dialogRect.top + 110),
        visible: rect.width > 0 && rect.height > 0,
      };
    })
    .filter((item) => (!item.inDialog || item.inDialogHeader) && item.visible
      && (/salida|vuelta|regreso|fecha/i.test(`${item.placeholder} ${item.label} ${item.title}`)
        || /\b\d{1,2}\s+[a-záéíóú]{3,}\b/i.test(`${item.value} ${item.text} ${item.label}`))));
}

function dateIsInControls(snapshot: Awaited<ReturnType<typeof dateControlSnapshot>>, date: string) {
  return snapshot.some((item) => calendarDateTextMatches(`${item.value} ${item.text} ${item.label} ${item.title}`, date));
}

function safeScreenshotName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 90) || "pantalla";
}

async function captureRunScreen(page: Page, context: RunScreenshotContext | null | undefined, label: string) {
  if (!context) return;
  const file = `${String(++context.sequence).padStart(4, "0")}_${safeScreenshotName(label)}.png`;
  try {
    await page.screenshot({ path: path.join(context.directory, file), fullPage: false, animations: "disabled", timeout: 15_000 });
    context.manifest.push({ file, label, capturedAt: new Date().toISOString(), url: page.url().split("?")[0] });
    await writeFile(path.join(context.directory, "capturas.json"), JSON.stringify(context.manifest, null, 2), "utf8");
  } catch (error) {
    // A screenshot must never break or cancel a flight search.
    context.manifest.push({ file: "", label: `${label} (falló captura: ${error instanceof Error ? error.message : "error"})`, capturedAt: new Date().toISOString(), url: page.url().split("?")[0] });
  }
}

export async function stopGoogleFlightsRun(runId: string) {
  stoppedRunIds.add(runId);
  const browser = flightBrowsers.get(runId);
  if (browser) await browser.close().catch(() => undefined);
}

const FLIGHTS_URL = "https://www.google.com/travel/flights?hl=es-419&gl=CO&curr=COP";
export const MAX_COMBINATIONS = 50;
export const MAX_WEEKEND_ESCAPE_COMBINATIONS = 200;

const colombianAirportCodes = new Set(["BOG", "MDE", "CLO", "CTG", "BAQ", "BGA", "SMR", "ADZ", "PEI", "CUC", "NVA", "VVC", "AXM", "EOH", "IBE", "MTR", "RCH", "UIB", "PSO", "LET", "APO", "CRC", "GPI", "TCO", "FLA", "CVE", "MZL", "PDA", "EJA", "CQT", "PPN", "SJE", "GUA"]);
const airportTimeZones: Record<string, string> = {
  JFK: "America/New_York", EWR: "America/New_York", LGA: "America/New_York", MIA: "America/New_York", ATL: "America/New_York", BOS: "America/New_York", IAD: "America/New_York", DCA: "America/New_York", MCO: "America/New_York", FLL: "America/New_York", YYZ: "America/Toronto", YUL: "America/Toronto", YVR: "America/Vancouver", LAX: "America/Los_Angeles", SFO: "America/Los_Angeles", SEA: "America/Los_Angeles", DEN: "America/Denver", DFW: "America/Chicago", ORD: "America/Chicago", IAH: "America/Chicago", MEX: "America/Mexico_City", CUN: "America/Cancun", SJO: "America/Costa_Rica", PTY: "America/Panama", LIM: "America/Lima", UIO: "America/Guayaquil", GYE: "America/Guayaquil", CCS: "America/Caracas", GRU: "America/Sao_Paulo", GIG: "America/Sao_Paulo", EZE: "America/Argentina/Buenos_Aires", SCL: "America/Santiago", MAD: "Europe/Madrid", BCN: "Europe/Madrid", LHR: "Europe/London", CDG: "Europe/Paris", AMS: "Europe/Amsterdam", FRA: "Europe/Berlin", FCO: "Europe/Rome", LIS: "Europe/Lisbon", MUC: "Europe/Berlin", IST: "Europe/Istanbul", DXB: "Asia/Dubai", DOH: "Asia/Qatar", DEL: "Asia/Kolkata", BOM: "Asia/Kolkata", SIN: "Asia/Singapore", HKG: "Asia/Hong_Kong", NRT: "Asia/Tokyo", HND: "Asia/Tokyo", SYD: "Australia/Sydney",
};

export function airportTimeZone(iata: string): string {
  const known = airportTimeZones[iata.toUpperCase()];
  if (known) return known;
  if (colombianAirportCodes.has(iata.toUpperCase())) return "America/Bogota";
  throw new Error(`No hay zona horaria configurada para el aeropuerto de origen ${iata}; no es posible validar con precisión la anticipación mínima.`);
}

export function timeTextToMinutes(value: string): number | null {
  const match = value.match(/(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)/i);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]), pm = /^p/i.test(match[3]);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return ((hour % 12) + (pm ? 12 : 0)) * 60 + minute;
}

export function isTimeInWindow(value: string, start: number, end: number): boolean {
  const minutes = timeTextToMinutes(value);
  return minutes !== null && minutes >= start && minutes <= end;
}

function localDepartureEpoch(date: string, time: string, timeZone: string): number | null {
  const minutes = timeTextToMinutes(time);
  if (minutes === null) return null;
  const target = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Math.floor(minutes / 60), minutes % 60);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
    guess += target - represented;
  }
  return guess;
}

export function hasMinimumNotice(date: string, time: string, timeZone: string, minimumHours: number, now = Date.now()): boolean {
  const departure = localDepartureEpoch(date, time, timeZone);
  return departure !== null && departure - now >= minimumHours * 3_600_000;
}


async function chooseAirport(page: Page, fieldLabel: RegExp, code: string) {
  const input = page.getByRole("combobox", { name: fieldLabel }).first();
  await input.fill(code);
  const option = page.getByRole("option").filter({ hasText: code }).first();
  try {
    await option.waitFor({ state: "visible", timeout: 8_000 });
    await option.click();
    return;
  } catch {
    const result = page.locator("[role='listbox']").getByText(new RegExp(code, "i")).first();
    if (await result.count()) {
      await result.click();
      return;
    }
  }
  throw new Error(`Google Flights no ofreció una sugerencia de aeropuerto para ${code}.`);
}

async function chooseTripType(page: Page, tripType: FollowUp["tripType"]) {
  const label = tripType === "one_way" ? /solo ida/i : /ida y vuelta/i;
  const current = page.getByRole("combobox").filter({ hasText: /ida y vuelta|solo ida/i }).first();
  if (!(await current.count())) throw new Error("No aparece el selector de tipo de viaje en Google Flights.");
  const currentText = await current.innerText().catch(() => "");
  if (label.test(currentText)) return;
  await current.click();
  const option = page.getByRole("option").filter({ hasText: label }).last();
  await option.waitFor({ state: "visible", timeout: 8_000 });
  await option.click();
  const selected = await current.innerText().catch(() => "");
  if (!label.test(selected)) throw new Error("Google Flights no confirmó el tipo de viaje seleccionado.");
}

async function chooseAdults(page: Page, adults: number) {
  if (adults === 1) return;
  const trigger = page.getByRole("button", { name: /pasajero.*cambiar cantidad/i });
  if (!(await trigger.count())) throw new Error("No aparece el selector de pasajeros en Google Flights.");
  await trigger.click();
  const adultLabel = page.getByText("Adultos", { exact: true }).first();
  if (!(await adultLabel.count())) throw new Error("No aparece el control de adultos en Google Flights.");
  const row = adultLabel.locator("xpath=..");
  const text = await row.innerText().catch(() => "1");
  const current = Number(text.match(/\b(\d+)\b/)?.[1] ?? 1);
  const delta = adults - current;
  const button = row.getByRole("button", { name: delta > 0 ? /agregar adulto/i : /quitar adulto/i });
  if (delta !== 0 && !(await button.count())) throw new Error("No pude cambiar la cantidad de adultos en Google Flights.");
  for (let index = 0; index < Math.abs(delta); index++) await button.click();
  const countControl = row.locator('[aria-label="Cantidad de pasajeros adultos"]');
  const actual = Number(await countControl.getAttribute("aria-valuenow"));
  if (actual !== adults) throw new Error(`Google Flights no confirmo ${adults} adultos.`);
  const done = page.getByRole("button", { name: /listo|done/i }).last();
  if (await done.count()) await done.click();
}

async function parseCalendarPrices(page: Page, targets: string[], field: "Salida" | "Regreso", onUnparsedTargets?: (summary: string) => void, targetWaitSeconds = 4, screenshots?: RunScreenshotContext | null): Promise<FlightPriceResult[]> {
  const dialog = await openCalendar(page, field);
  await captureRunScreen(page, screenshots, `calendario-${field.toLowerCase()}-lectura-${targets[0] ?? "fechas"}`);
  const output = new Map<string, FlightPriceResult>();
  type CalendarCell = { label: string; text: string; parentText: string; left: number; top: number; right: number; bottom: number };
  const readCells = (): Promise<CalendarCell[]> => dialog.locator("[role='button']").evaluateAll((items) => items.map((item) => {
    const label = item.getAttribute("aria-label") ?? item.querySelector("[aria-label]")?.getAttribute("aria-label") ?? "";
    const rect = item.getBoundingClientRect();
    const parent = item.parentElement;
    return { label, text: (item as HTMLElement).innerText ?? item.textContent ?? "", parentText: (parent as HTMLElement | null)?.innerText ?? "", left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }));
  const dialogBox = await dialog.boundingBox();
  if (!dialogBox) return [];
  const isInViewport = (cell: CalendarCell) => cell.right > dialogBox.x + 2 && cell.left < dialogBox.x + dialogBox.width - 2 && cell.bottom > dialogBox.y + 70 && cell.top < dialogBox.y + dialogBox.height - 55;
  const collectVisibleTargets = (cells: CalendarCell[]) => {
    for (const target of targets) {
      if (output.has(target)) continue;
      const cell = cells.find((item) => item.label.startsWith(calendarDateLabel(target)) && isInViewport(item));
      if (!cell) continue;
      const price = parsePrice(cell.text);
      if (price) output.set(target, { outboundDate: target, inboundDate: null, amount: price.amount, currency: price.currency, comparable: price.currency === "COP", meetsThreshold: false, observedText: cell.text.trim(), details: price.currency === "COP" ? null : "El calendario mostró una moneda distinta de COP; se conserva en el historial sin conversión." });
    }
  };

  // Total return prices often arrive several seconds after selecting the outbound date.
  // Wait for the requested visible dates, not merely any fare elsewhere in the
  // calendar; unrelated fares can render before the target day's price.
  for (let attempt = 0; attempt < targetWaitSeconds; attempt++) {
    const cells = await readCells();
    collectVisibleTargets(cells);
    const visibleTargets = targets.filter((target) => cells.some((cell) => cell.label.startsWith(calendarDateLabel(target)) && isInViewport(cell)));
    const targetPricesLoaded = visibleTargets.length > 0 && visibleTargets.every((target) => output.has(target));
    if (targetPricesLoaded || visibleTargets.length === 0 || attempt === targetWaitSeconds - 1) break;
    await page.waitForTimeout(1_000);
  }

  // Google keeps future month cells in the DOM before displaying them. Their
  // fare text is only loaded once the calendar is advanced to that month.
  for (let pageIndex = 0; pageIndex < 14; pageIndex++) {
    let cells = await readCells();
    collectVisibleTargets(cells);
    const visibleTargets = new Set(targets.filter((target) => cells.some((cell) => cell.label.startsWith(calendarDateLabel(target)) && isInViewport(cell))));
    if (visibleTargets.size === targets.length || pageIndex === 5) break;
    const previousMonthSignature = cells.filter(isInViewport).map((cell) => cell.label).join("|");
    // Google varies this accessible name between "Siguiente", "Siguiente mes"
    // and English "Next month". Scope navigation to the calendar dialog so
    // date arrows elsewhere on the flight form cannot be mistaken for it.
    const next = dialog.getByRole("button", { name: /siguiente|pr[oó]ximo|next/i }).last();
    if (!(await next.count()) || !(await next.isVisible().catch(() => false))) break;
    await next.click();
    // Wait briefly for the month transition. Don't spend the fare-loading
    // timeout on intermediate months that do not contain any requested date.
    let monthChanged = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      cells = await readCells();
      const signature = cells.filter(isInViewport).map((cell) => cell.label).join("|");
      if (signature && signature !== previousMonthSignature) { monthChanged = true; break; }
      await page.waitForTimeout(100);
    }
    if (!monthChanged) continue;
    await captureRunScreen(page, screenshots, `calendario-${field.toLowerCase()}-mes-${pageIndex + 2}-${targets[0] ?? "fechas"}`);
    collectVisibleTargets(cells);
    const targetDatesInMonth = targets.filter((target) => cells.some((cell) => cell.label.startsWith(calendarDateLabel(target)) && isInViewport(cell)));
    if (targetDatesInMonth.length === 0) continue;
    // Wait for target fares only once a requested month is visible.
    for (let attempt = 0; attempt < targetWaitSeconds; attempt++) {
      await page.waitForTimeout(1_000);
      cells = await readCells();
      collectVisibleTargets(cells);
      const nowVisible = new Set(targets.filter((target) => cells.some((cell) => cell.label.startsWith(calendarDateLabel(target)) && isInViewport(cell))));
      if (nowVisible.size > 0 && [...nowVisible].every((target) => output.has(target))) break;
    }
  }
  const missingTargets = targets.filter((target) => !output.has(target));
  if (missingTargets.length && onUnparsedTargets) {
    const finalCells = await readCells();
    const selectedFields = await page.locator("input").evaluateAll((items) => items.map((item) => `${item.getAttribute("placeholder") ?? item.getAttribute("aria-label") ?? "input"}=${(item as HTMLInputElement).value}`).join(" | "));
    const summaries = missingTargets.map((target) => {
      const expectedLabel = calendarDateLabel(target);
      const candidate = finalCells.find((cell) => cell.label.startsWith(expectedLabel));
      return candidate
        ? `${target}: celda="${candidate.label}" texto="${candidate.text.trim().slice(0, 100)}" contenedor="${candidate.parentText.trim().slice(0, 140)}" campos="${selectedFields.slice(0, 240)}"`
        : `${target}: fecha no visible; etiquetas visibles=${finalCells.filter(isInViewport).slice(0, 8).map((cell) => cell.label || "sin aria-label").join(" | ")}`;
    });
    onUnparsedTargets(summaries.join("; "));
  }
  return [...output.values()];
}
async function openCalendar(page: Page, field: "Salida" | "Regreso" = "Salida") {
  const currentDialog = page.getByRole("dialog").last();
  if (await currentDialog.count() && await currentDialog.isVisible().catch(() => false)) {
    return currentDialog;
  }
  const input = page.getByPlaceholder(field, { exact: true }).first();
  if (!(await input.count())) throw new Error(`No aparece el campo ${field} en Google Flights.`);
  await input.click();
  const dialog = page.getByRole("dialog").last();
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  return dialog;
}

async function closeCalendar(page: Page, screenshots?: RunScreenshotContext | null) {
  // The footer action varies between locales/layouts ("Listo", "Hecho" and
  // "Done"). Search only inside the date dialog to avoid unrelated controls.
  const dialog = page.getByRole("dialog").last();
  if (!(await dialog.count()) || !(await dialog.isVisible().catch(() => false))) return;
  const done = dialog.getByRole("button", { name: /listo|hecho|done/i }).last();
  if (await done.count() && await done.isVisible().catch(() => false)) {
    await logFlightStep(screenshots, "Cerrar calendario", "info", { button: await done.getAttribute("aria-label").catch(() => null), state: "click" });
    await done.click({ timeout: 8_000 });
    const closed = await page.getByRole("dialog").last().waitFor({ state: "hidden", timeout: 5_000 }).then(() => true).catch(() => false);
    if (closed) return;
  }
  await logFlightStep(screenshots, "Cerrar calendario", "warning", { state: "fallback-escape", dialogVisible: await dialog.isVisible().catch(() => false) });
  await page.keyboard.press("Escape").catch(() => undefined);
  const closed = await page.getByRole("dialog").last().waitFor({ state: "hidden", timeout: 3_000 }).then(() => true).catch(() => false);
  if (!closed) {
    await captureRunScreen(page, screenshots, "error-calendario-no-cerrado");
    const inputs = await dateControlSnapshot(page).catch(() => []);
    await logFlightStep(screenshots, "Cerrar calendario", "error", { state: "still-open", inputs });
    throw new Error("Google Flights mantuvo abierto el calendario después de confirmar las fechas.");
  }
}

function calendarDateLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

async function selectCalendarDateLegacy(page: Page, date: string, screenshots?: RunScreenshotContext | null) {
  const selector = `[aria-label^=${JSON.stringify(calendarDateLabel(date))}]`;
  const dialog = page.getByRole("dialog").last();
  for (let month = 0; month < 14; month++) {
    const day = dialog.locator(selector).last();
    if (await day.isVisible().catch(() => false)) {
      await day.click();
      await page.waitForTimeout(1_500);
      return;
    }
    const next = dialog.getByRole("button", { name: /siguiente|pr[oó]ximo|next/i }).last();
    if (!(await next.count()) || !(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(150);
    await captureRunScreen(page, screenshots, `navegacion-calendario-${date}-mes-${month + 2}`);
  }
  throw new Error(`El calendario no mostró la fecha de ida ${date}.`);
}

async function selectCalendarDate(page: Page, date: string, screenshots?: RunScreenshotContext | null) {
  const selector = `[aria-label^=${JSON.stringify(calendarDateLabel(date))}]`;
  const dialog = page.getByRole("dialog").last();
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  await logFlightStep(screenshots, "Seleccionar fecha calendario", "info", { targetDate: date, targetLabel: calendarDateLabel(date), initialInputs: await dateControlSnapshot(page) });

  for (let month = 0; month < 14; month++) {
    const dialogBox = await dialog.boundingBox();
    const matchingDays = dialog.locator(selector);
    for (let index = (await matchingDays.count()) - 1; index >= 0; index--) {
      const day = matchingDays.nth(index);
      if (!(await day.isVisible().catch(() => false))) continue;
      const box = await day.boundingBox().catch(() => null);
      const isCurrentMonthCell = Boolean(box && dialogBox && box.x >= dialogBox.x && box.x < dialogBox.x + dialogBox.width && box.y >= dialogBox.y + 75 && box.y < dialogBox.y + dialogBox.height - 60);
      if (!isCurrentMonthCell) continue;

      const ariaLabel = await day.getAttribute("aria-label").catch(() => null);
      await captureRunScreen(page, screenshots, `calendario-${date}-antes-de-seleccionar`);
      await day.click({ timeout: 8_000 });
      for (let wait = 0; wait < 20; wait++) {
        const selectedInputs = await dateControlSnapshot(page);
        if (dateIsInControls(selectedInputs, date)) {
          await logFlightStep(screenshots, "Seleccionar fecha calendario", "success", { targetDate: date, ariaLabel, attempt: 1, selectedInputs });
          await captureRunScreen(page, screenshots, `calendario-${date}-seleccion-confirmada`);
          return;
        }
        await page.waitForTimeout(250);
      }

      await logFlightStep(screenshots, "Seleccionar fecha calendario", "warning", { targetDate: date, ariaLabel, attempt: 1, issue: "click-no-confirmado", selectedInputs: await dateControlSnapshot(page) });
      await day.click({ force: true, timeout: 5_000 }).catch(() => undefined);
      for (let wait = 0; wait < 12; wait++) {
        const selectedInputs = await dateControlSnapshot(page);
        if (dateIsInControls(selectedInputs, date)) {
          await logFlightStep(screenshots, "Seleccionar fecha calendario", "success", { targetDate: date, ariaLabel, attempt: 2, selectedInputs });
          await captureRunScreen(page, screenshots, `calendario-${date}-seleccion-confirmada`);
          return;
        }
        await page.waitForTimeout(250);
      }
      await captureRunScreen(page, screenshots, `error-fecha-no-confirmada-${date}`);
      const selectedInputs = await dateControlSnapshot(page);
      await logFlightStep(screenshots, "Seleccionar fecha calendario", "error", { targetDate: date, ariaLabel, attempt: 2, issue: "seleccion-no-reflejada-en-campos", selectedInputs });
      throw new Error(`Google Flights no confirmó la selección de ${date}; campos: ${JSON.stringify(selectedInputs)}.`);
    }

    const previousMonthText = (await dialog.innerText().catch(() => "")).slice(0, 240);
    const next = dialog.getByRole("button", { name: /siguiente|pr[oÃ³]ximo|next/i }).last();
    if (!(await next.count()) || !(await next.isVisible().catch(() => false))) {
      const visibleLabels = await dialog.locator("[role='button'][aria-label]").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label") ?? "").slice(0, 12));
      await logFlightStep(screenshots, "Navegar calendario", "error", { targetDate: date, month, issue: "sin-boton-mes-siguiente", visibleLabels, controls: await dateControlSnapshot(page) });
      break;
    }
    await next.click();
    let changed = false;
    for (let wait = 0; wait < 20; wait++) {
      const currentMonthText = (await dialog.innerText().catch(() => "")).slice(0, 240);
      if (currentMonthText !== previousMonthText) { changed = true; break; }
      await page.waitForTimeout(150);
    }
    await logFlightStep(screenshots, "Navegar calendario", changed ? "info" : "warning", { targetDate: date, month, changed, visibleMonthText: (await dialog.innerText().catch(() => "")).slice(0, 240) });
    await captureRunScreen(page, screenshots, `navegacion-calendario-${date}-mes-${month + 2}`);
  }

  const state = { targetDate: date, controls: await dateControlSnapshot(page).catch(() => []), dialogVisible: await dialog.isVisible().catch(() => false), dialogText: (await dialog.innerText().catch(() => "")).slice(0, 500) };
  await captureRunScreen(page, screenshots, `error-fecha-calendario-no-encontrada-${date}`);
  await logFlightStep(screenshots, "Seleccionar fecha calendario", "error", state);
  throw new Error(`Google Flights no confirmó la fecha ${date}. ${JSON.stringify(state)}`);
}

async function assertSelectedDates(page: Page, outboundDate: string, inboundDate?: string | null, screenshots?: RunScreenshotContext | null) {
  const controls = await dateControlSnapshot(page);
  const outboundSelected = dateIsInControls(controls, outboundDate);
  const inboundSelected = !inboundDate || dateIsInControls(controls, inboundDate);
  await logFlightStep(screenshots, "Verificar fechas seleccionadas", outboundSelected && inboundSelected ? "success" : "error", {
    outboundDate, inboundDate: inboundDate ?? null, outboundSelected, inboundSelected, controls,
  });
  if (!outboundSelected || !inboundSelected) {
    await captureRunScreen(page, screenshots, `error-verificar-fechas-${outboundDate}${inboundDate ? `-${inboundDate}` : ""}`);
    throw new Error(`Google Flights no dejó seleccionadas las fechas solicitadas. Ida ${outboundDate}: ${outboundSelected ? "confirmada" : "no confirmada"}; regreso ${inboundDate ?? "no aplica"}: ${inboundSelected ? "confirmado" : "no confirmado"}.`);
  }
}

async function setAirport(page: Page, label: RegExp, code: string) {
  await chooseAirport(page, label, code);
}

async function prepareForm(page: Page, followUp: FollowUp, destination = followUp.destinationIata) {
  await chooseTripType(page, followUp.tripType);
  await setAirport(page, /¿Desde dónde\?/i, followUp.originIata);
  await setAirport(page, /¿A dónde quieres ir\?/i, destination);
  await chooseAdults(page, followUp.adults);
}

async function waitForFlightCard(page: Page, cards: ReturnType<Page["locator"]>) {
  let deadline = Date.now() + 45_000;
  let reloads = 0;
  while (Date.now() < deadline) {
    if (await cards.count() && await cards.first().isVisible().catch(() => false)) return;
    const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    if (/no se encontraron resultados.{0,80}se produjo un error|there was an error.{0,80}results/i.test(text)) {
      // Flights renders this action as a button in some layouts and as plain
      // accessible text in others. Try both before classifying the attempt.
      const reloadButton = page.getByRole("button", { name: /volver a cargar|reload/i }).last();
      const reloadText = page.getByText(/volver a cargar|reload/i).last();
      const reload = await reloadButton.count() && await reloadButton.isVisible().catch(() => false)
        ? reloadButton
        : reloadText;
      if (reloads < 2 && await reload.count() && await reload.isVisible().catch(() => false)) {
        reloads++;
        await reload.click().catch(() => undefined);
        await page.waitForTimeout(4_000);
        deadline = Date.now() + 45_000;
        continue;
      }
      throw new Error(`Transient Google Flights results error after ${reloads} page reload(s).`);
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error("Timed out waiting for Google Flights result cards.");
}

async function resultCards(page: Page) {
  // Google changes the localized accessible name between layouts/releases.
  // Match the stable flight-card role plus flight wording rather than one
  // exact "Seleccionar vuelo" phrase.
  const cards = page.locator('[role="link"][aria-label*="vuelo" i]:visible, [role="link"][aria-label*="flight" i]:visible');
  try {
    await waitForFlightCard(page, cards);
  } catch {
    const currentUrl = page.url().split("?")[0];
    const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    const pageText = bodyText.match(/(?:no se encontraron resultados.{0,100}|se produjo un error.{0,100}|there was an error.{0,100})/i)?.[0] ?? bodyText.slice(0, 120);
    throw new Error(`Google Flights no mostró tarjetas de vuelos tras esperar 45 segundos. URL: ${currentUrl}. Página: ${pageText || "sin texto visible"}`);
  }
  return cards;
}

async function readCards(cards: Awaited<ReturnType<typeof resultCards>>) {
  return cards.evaluateAll((nodes) => nodes.map((node) => {
    let current: Element | null = node;
    let text = "";
    let logoUrl: string | null = null;
    let logoAirlineName: string | null = null;
    for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
      const candidate = (current as HTMLElement).innerText ?? current.textContent ?? "";
      if (/\d{1,2}:\d{2}/.test(candidate) && /COP|pesos colombianos|\$/.test(candidate)) {
        text = candidate;
        const images = [...current.querySelectorAll("img")];
        const label = (node.getAttribute("aria-label") ?? "").toLocaleLowerCase();
        // Keep predicates inline: Playwright serializes this callback into the
        // page, where TypeScript transpiler helpers such as __name do not exist.
        const logo = images.find((image) => /^https:\/\//i.test(image.currentSrc || image.src) && Boolean(image.alt?.trim()) && (label.includes(image.alt.toLocaleLowerCase()) || candidate.toLocaleLowerCase().includes(image.alt.toLocaleLowerCase())))
          ?? images.find((image) => /^https:\/\//i.test(image.currentSrc || image.src) && Boolean(image.alt?.trim()))
          ?? images.find((image) => /^https:\/\//i.test(image.currentSrc || image.src));
        logoUrl = logo ? (logo.currentSrc || logo.src) : null;
        logoAirlineName = logo?.alt?.trim() || null;
        break;
      }
    }
    return { label: node.getAttribute("aria-label") ?? "", text, logoUrl, logoAirlineName };
  }));
}

async function getOneWayOptions(page: Page, threshold: number, screenshots?: RunScreenshotContext | null): Promise<FlightItineraryOption[]> {
  const cards = await resultCards(page);
  await captureRunScreen(page, screenshots, "resultados-vuelos-solo-ida");
  const raw = await readCards(cards);
  const found: FlightItineraryOption[] = [];
  raw.forEach((item) => {
    const card = parseGoogleFlightCard(item.label, item.text, item.logoUrl, item.logoAirlineName);
    if (!card || card.amount > threshold) return;
    found.push({ outboundAirline: card.airline, outboundLogoUrl: card.logoUrl, outboundOperatedBy: card.operatedBy,
      inboundAirline: null, inboundLogoUrl: null, inboundOperatedBy: null, outboundDepartureTime: card.departureTime,
      outboundArrivalTime: card.arrivalTime, inboundDepartureTime: null, inboundArrivalTime: null,
      amount: card.amount, currency: card.currency, outboundStops: card.stops, inboundStops: null,
      separateTickets: card.separateTickets });
  });
  return found;
}

export type EscapeCriteria = { outboundDate: string; inboundDate: string; outboundWindow: "friday_evening" | "saturday_morning"; inboundWindow: "sunday_evening" | "monday_holiday_evening"; originTimeZone: string; minimumNoticeHours: number };

export function passesEscapeSchedule(option: FlightItineraryOption, criteria: EscapeCriteria, now = Date.now()) {
  const outboundWindow = criteria.outboundWindow === "friday_evening" ? [19 * 60, 22 * 60] : [6 * 60, 10 * 60];
  const returnWindow = [16 * 60, 20 * 60];
  if (!isTimeInWindow(option.outboundDepartureTime, outboundWindow[0], outboundWindow[1])) return false;
  if (!option.inboundDepartureTime || !isTimeInWindow(option.inboundDepartureTime, returnWindow[0], returnWindow[1])) return false;
  return hasMinimumNotice(criteria.outboundDate, option.outboundDepartureTime, criteria.originTimeZone, criteria.minimumNoticeHours, now);
}

async function getRoundTripOptions(page: Page, threshold: number, escapeCriteria?: EscapeCriteria, screenshots?: RunScreenshotContext | null): Promise<FlightItineraryOption[]> {
  const outboundCards = await resultCards(page);
  await captureRunScreen(page, screenshots, "resultados-vuelos-ida");
  const outboundRaw = await readCards(outboundCards);
  const collected: FlightItineraryOption[] = [];
  for (let index = 0; index < outboundRaw.length; index++) {
    const outbound = parseGoogleFlightCard(outboundRaw[index].label, outboundRaw[index].text, outboundRaw[index].logoUrl, outboundRaw[index].logoAirlineName);
    // Google displays the cheapest round-trip total associated with this outbound.
    // If that lower bound is above the alert threshold, no return can qualify.
    if (!outbound || outbound.amount > threshold) continue;
    // The accessible card contains the selectable flight link, while its time
    // label varies between Google Flights layouts and is not reliably clickable.
    await outboundCards.nth(index).click({ timeout: 15_000, force: true });
    let returnCards;
    try {
      returnCards = await resultCards(page);
      await captureRunScreen(page, screenshots, `regresos-para-salida-${index + 1}`);
    } catch {
      throw new Error("Google Flights cargó la salida pero no mostró la lista de vuelos de regreso.");
    }
    const returnRaw = await readCards(returnCards);
    for (const item of returnRaw) {
      const inbound = parseGoogleFlightCard(item.label, item.text, item.logoUrl, item.logoAirlineName);
      if (!inbound || inbound.amount > threshold) continue;
      const option: FlightItineraryOption = { outboundAirline: outbound.airline, outboundLogoUrl: outbound.logoUrl, outboundOperatedBy: outbound.operatedBy,
        inboundAirline: inbound.airline, inboundLogoUrl: inbound.logoUrl, inboundOperatedBy: inbound.operatedBy,
        outboundDepartureTime: outbound.departureTime, outboundArrivalTime: outbound.arrivalTime,
        inboundDepartureTime: inbound.departureTime, inboundArrivalTime: inbound.arrivalTime,
        amount: inbound.amount, currency: inbound.currency, outboundStops: outbound.stops,
        inboundStops: inbound.stops, separateTickets: outbound.separateTickets || inbound.separateTickets };
      if (!escapeCriteria || passesEscapeSchedule(option, escapeCriteria)) collected.push(option);
    }
    // In the return-selection view, Google labels the route control simply
    // "CTG–BOG Cambiar" rather than "Cambiar el vuelo de ida".
    const change = page.getByText("Cambiar", { exact: true }).last();
    if (await change.count()) {
      await change.click();
      // Wait until Google has restored the outbound list before clicking the
      // next departure; fixed short sleeps race with slower result rendering.
      await resultCards(page);
    } else break;
  }
  const unique = new Map<string, FlightItineraryOption>();
  for (const option of collected) unique.set(JSON.stringify(option), option);
  return [...unique.values()];
}

async function fetchFlightOptionsAttempt(page: Page, followUp: FollowUp, result: FlightPriceResult, destination: string, escapeCriteria?: EscapeCriteria, screenshots?: RunScreenshotContext | null) {
  const attemptStartedAt = Date.now();
  try {
    await logFlightStep(screenshots, "Iniciar lectura de horarios", "info", { destination, outboundDate: result.outboundDate, inboundDate: result.inboundDate, tripType: followUp.tripType, thresholdCop: followUp.maxPriceCop });
    // Start from the same clean search form for each qualifying calendar fare.
    // Google replaces the date inputs with compact date controls after results load.
    await page.goto(FLIGHTS_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("combobox", { name: /¿Desde dónde\?/i }).waitFor({ state: "visible", timeout: 20_000 });
    await captureRunScreen(page, screenshots, `inicio-detalle-${destination}-${result.outboundDate}`);
    await prepareForm(page, followUp, destination);
    await captureRunScreen(page, screenshots, `formulario-detalle-${destination}-${result.outboundDate}`);
    await openCalendar(page, "Salida");
    await captureRunScreen(page, screenshots, `calendario-detalle-${destination}-${result.outboundDate}`);
    await selectCalendarDate(page, result.outboundDate, screenshots);
    if (followUp.tripType === "round_trip" && result.inboundDate) await selectCalendarDate(page, result.inboundDate, screenshots);
    await assertSelectedDates(page, result.outboundDate, followUp.tripType === "round_trip" ? result.inboundDate : null, screenshots);
    await closeCalendar(page, screenshots);
    // The page also has many suggested-destination cards whose accessible
    // names begin with "Buscar vuelos". Target the actual form submit button.
    const search = page.locator('button[aria-label="Buscar"]').last();
    await search.waitFor({ state: "visible", timeout: 10_000 });
    await logFlightStep(screenshots, "Buscar detalle tras precio válido", "info", { destination, outboundDate: result.outboundDate, inboundDate: result.inboundDate, buttonVisible: await search.isVisible().catch(() => false), calendarOpen: await page.getByRole("dialog").last().isVisible().catch(() => false) });
    await search.click();
    await captureRunScreen(page, screenshots, `resultados-detalle-${destination}-${result.outboundDate}`);
    const options = followUp.tripType === "one_way"
      ? await getOneWayOptions(page, followUp.maxPriceCop, screenshots)
      : await getRoundTripOptions(page, followUp.maxPriceCop, escapeCriteria, screenshots);
    await logFlightStep(screenshots, "Detalle de horarios leído", options.length ? "success" : "warning", { destination, outboundDate: result.outboundDate, inboundDate: result.inboundDate, optionCount: options.length, elapsedMs: Date.now() - attemptStartedAt, escapeScheduleApplied: Boolean(escapeCriteria) });
    if (escapeCriteria && !options.length) return { ...result, meetsThreshold: false, details: [result.details, "El calendario dio un precio bajo el límite, pero no se encontraron vuelos que cumplan los horarios y la anticipación configurados."].filter(Boolean).join(" "), flightOptions: [], flightDetailsStatus: "no_matching_flights" as const };
    return { ...result, flightOptions: options, flightDetailsStatus: options.length ? "available" as const : "unavailable" as const };
  } catch (error) {
    await captureRunScreen(page, screenshots, `error-detalle-${destination}-${result.outboundDate}`);
    const reason = error instanceof Error ? error.message.slice(0, 900) : "Error no identificado";
    await logFlightStep(screenshots, "Fallo al leer detalle de horarios", "error", { destination, outboundDate: result.outboundDate, inboundDate: result.inboundDate, reason, elapsedMs: Date.now() - attemptStartedAt, url: page.url().split("?")[0] });
    return { ...result, details: [result.details, `No se pudo obtener el detalle de vuelos: ${reason}`].filter(Boolean).join(" "), flightOptions: [], flightDetailsStatus: "unavailable" as const };
  }
}

async function fetchFlightOptions(page: Page, followUp: FollowUp, result: FlightPriceResult, destination = followUp.destinationIata, escapeCriteria?: EscapeCriteria, screenshots?: RunScreenshotContext | null) {
  let detailed: Awaited<ReturnType<typeof fetchFlightOptionsAttempt>> | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await logFlightStep(screenshots, "Intento de lectura de horarios", "info", { attempt, maxAttempts: 2, destination, outboundDate: result.outboundDate, inboundDate: result.inboundDate });
    detailed = await fetchFlightOptionsAttempt(page, followUp, result, destination, escapeCriteria, screenshots);
    if (detailed.flightDetailsStatus !== "unavailable" || attempt === 2) break;
    await logFlightStep(screenshots, "Reintento de lectura de horarios", "warning", { failedAttempt: attempt, reason: detailed.details?.slice(-900) ?? "sin detalle" });
    await page.waitForTimeout(2_000);
  }
  return detailed!;
}

function bogotaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function scanWeekendEscape(page: Page, followUp: FollowUp, screenshots?: RunScreenshotContext | null, onProgress?: SearchProgressCallback): Promise<FlightPriceResult[]> {
  const destinations = [...new Set(followUp.destinationIatas?.length ? followUp.destinationIatas : [followUp.destinationIata])];
  const lookaheadDays = followUp.lookaheadDays ?? 120;
  const originTimeZone = airportTimeZone(followUp.originIata);
  const candidates = weekendEscapeCandidates(destinations, bogotaToday(), lookaheadDays, MAX_WEEKEND_ESCAPE_COMBINATIONS);
  if (!candidates.length) return [];
  const results: FlightPriceResult[] = [];
  const pendingDetails: Array<{ result: FlightPriceResult; destination: string; criteria: EscapeCriteria }> = [];
  let checkedCandidates = 0;
  const destinationTotals = new Map(destinations.map((destination) => [destination, candidates.filter((candidate) => candidate.destinationIata === destination).length]));
  const destinationCompleted = new Map(destinations.map((destination) => [destination, 0]));
  const destinationProgress = () => destinations.map((destinationIata) => ({
    destinationIata,
    completed: destinationCompleted.get(destinationIata) ?? 0,
    total: destinationTotals.get(destinationIata) ?? 0,
  }));
  const emitProgress = (phase: string, current?: string, completed = checkedCandidates, total = candidates.length) => onProgress?.({
    phase,
    completed,
    total,
    ...(current ? { current } : {}),
    destinationProgress: destinationProgress(),
  });
  emitProgress("Seleccionando fechas de ida");

  for (const destination of destinations) {
    const destinationCandidates = candidates.filter((candidate) => candidate.destinationIata === destination);
    const outboundDates = [...new Set(destinationCandidates.map((candidate) => candidate.outboundDate))];
    if (!outboundDates.length) continue;
    await page.goto(FLIGHTS_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("combobox", { name: /¿Desde dónde\?/i }).waitFor({ state: "visible", timeout: 20_000 });
    await captureRunScreen(page, screenshots, `inicio-${destination}`);
    await prepareForm(page, followUp, destination);
    await captureRunScreen(page, screenshots, `formulario-${destination}`);
    const destinationResults: FlightPriceResult[] = [];
    for (const outboundDate of outboundDates) {
      const matchingCandidates = destinationCandidates.filter((candidate) => candidate.outboundDate === outboundDate);
      const inboundDates = [...new Set(matchingCandidates.map((candidate) => candidate.inboundDate))];
      emitProgress("Seleccionando fechas de ida", `${destination} · ${outboundDate}`);
      await openCalendar(page, "Salida");
      await captureRunScreen(page, screenshots, `calendario-salida-${destination}-${outboundDate}`);
      await selectCalendarDate(page, outboundDate, screenshots);
      await assertSelectedDates(page, outboundDate, null, screenshots);
      await captureRunScreen(page, screenshots, `calendario-ida-seleccionada-${destination}-${outboundDate}`);
      const returnPrices = new Map((await parseCalendarPrices(page, inboundDates, "Regreso", undefined, 12, screenshots)).map((fare) => [fare.outboundDate, fare]));
      await logFlightStep(screenshots, "Precios de regreso leídos", returnPrices.size ? "success" : "warning", { destination, outboundDate, expectedDates: inboundDates, prices: [...returnPrices.values()].map(({ outboundDate: date, amount, currency }) => ({ date, amount, currency })) });
      await captureRunScreen(page, screenshots, `calendario-regresos-con-precios-${destination}-${outboundDate}`);
      await closeCalendar(page, screenshots);
      for (const candidate of matchingCandidates) {
        const fare = returnPrices.get(candidate.inboundDate);
        if (!fare) continue;
        const nights = daysBetween(candidate.outboundDate, candidate.inboundDate) ?? 0;
        destinationResults.push({
          ...fare, outboundDate: candidate.outboundDate, inboundDate: candidate.inboundDate,
          destinationIata: destination,
          meetsThreshold: fare.amount !== null && fare.currency === "COP" && fare.amount <= followUp.maxPriceCop,
          details: fare.currency === "COP" ? `Escape de fin de semana (${nights} ${nights === 1 ? "noche" : "noches"}); precio total del calendario.` : "Se conserva la moneda sin conversión a COP.",
        });
      }
      checkedCandidates += matchingCandidates.length;
      destinationCompleted.set(destination, (destinationCompleted.get(destination) ?? 0) + matchingCandidates.length);
      emitProgress("Validando combinaciones", `${destination} · ${outboundDate}`);
    }

    for (const result of destinationResults) {
      if (result.meetsThreshold && result.amount !== null) {
        const candidate = destinationCandidates.find((item) => item.outboundDate === result.outboundDate && item.inboundDate === result.inboundDate)!;
        const criteria: EscapeCriteria = {
          outboundDate: candidate.outboundDate, inboundDate: candidate.inboundDate,
          outboundWindow: candidate.outboundWindow, inboundWindow: candidate.inboundWindow,
          originTimeZone, minimumNoticeHours: followUp.minNoticeHours ?? 8,
        };
        pendingDetails.push({ result, destination, criteria });
      } else results.push(result);
    }
  }
  emitProgress("Buscando horarios", undefined, 0, pendingDetails.length);
  for (let index = 0; index < pendingDetails.length; index++) {
    const item = pendingDetails[index];
    results.push(await fetchFlightOptions(page, { ...followUp, destinationIata: item.destination }, item.result, item.destination, item.criteria, screenshots));
    emitProgress("Buscando horarios", `${item.destination} · ${item.result.outboundDate}`, index + 1, pendingDetails.length);
  }
  return results;
}

export async function scanGoogleFlights(followUp: FollowUp, runId?: string, onProgress?: SearchProgressCallback): Promise<FlightPriceResult[]> {
  let browser: Browser | null = null;
  const plannedTotal = followUp.mode === "weekend_escape"
    ? weekendEscapeCandidates(followUp.destinationIatas?.length ? followUp.destinationIatas : [followUp.destinationIata], bogotaToday(), followUp.lookaheadDays ?? 120, MAX_WEEKEND_ESCAPE_COMBINATIONS).length
    : followUp.tripType === "one_way"
      ? dateRange(followUp.outboundMode, followUp.outboundStart, followUp.outboundEnd).length
      : validRoundTripPairs(followUp).length;
  onProgress?.({ phase: "Abriendo Google Flights", completed: 0, total: plannedTotal });
  const screenshotContext: RunScreenshotContext | null = runId ? {
    runId,
    directory: path.join(process.cwd(), "prints de pantallas", `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeScreenshotName(followUp.name)}_${runId}`),
    sequence: 0,
    manifest: [],
  } : null;
  try {
    if (screenshotContext) {
      await mkdir(screenshotContext.directory, { recursive: true });
      await writeFile(path.join(screenshotContext.directory, "ejecucion.json"), JSON.stringify({
        runId,
        followUpId: followUp.id,
        followUpName: followUp.name,
        originIata: followUp.originIata,
        destinations: followUp.destinationIatas?.length ? followUp.destinationIatas : [followUp.destinationIata],
        mode: followUp.mode ?? "standard",
        tripType: followUp.tripType,
        startedAt: new Date().toISOString(),
        note: "Las capturas corresponden a pantallas visibles de Google Flights durante esta ejecución.",
      }, null, 2), "utf8");
    }
    // Use the installed stable Chrome channel. On some Windows machines the
    // Playwright-downloaded headless-shell binary is blocked with spawn EPERM,
    // while the user's installed Chrome is allowed to launch headlessly.
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    if (runId) {
      flightBrowsers.set(runId, browser);
      if (stoppedRunIds.has(runId)) await browser.close();
    }
    const context = await browser.newContext({ locale: "es-CO", timezoneId: "America/Bogota", viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(FLIGHTS_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("combobox", { name: /¿Desde dónde\?/i }).waitFor({ state: "visible", timeout: 20_000 });
    await captureRunScreen(page, screenshotContext, "inicio-google-flights");
    if (followUp.mode === "weekend_escape") return await scanWeekendEscape(page, followUp, screenshotContext, onProgress);
    await prepareForm(page, followUp);
    await captureRunScreen(page, screenshotContext, "formulario-configurado");
    const results: FlightPriceResult[] = [];
    if (followUp.tripType === "one_way") {
      const dates = dateRange(followUp.outboundMode, followUp.outboundStart, followUp.outboundEnd);
      const candidateDates = dates.length ? dates : [followUp.outboundStart];
      const faresByDate = new Map<string, FlightPriceResult>();
      onProgress?.({ phase: "Seleccionando fechas de ida", completed: 0, total: candidateDates.length });
      for (let index = 0; index < candidateDates.length; index++) {
        const date = candidateDates[index];
        onProgress?.({ phase: "Seleccionando fecha de ida", completed: index, total: candidateDates.length, current: date });
        let fares: FlightPriceResult[] = [];
        for (let attempt = 1; attempt <= 3 && !fares.some((item) => item.outboundDate === date); attempt++) {
          const phase = attempt === 1 ? "Leyendo precio tras seleccionar la ida" : `Reintentando selección y lectura ${attempt}/3`;
          await openCalendar(page, "Salida");
          await captureRunScreen(page, screenshotContext, `calendario-${date}-intento-${attempt}-antes-del-clic`);
          // A repeated click forces Google to refresh the selected-date fare
          // instead of rereading a stale day cell. Wait for the target fare in
          // this same calendar session before confirming/closing it.
          await selectCalendarDate(page, date, screenshotContext);
          await assertSelectedDates(page, date, null, screenshotContext);
          await captureRunScreen(page, screenshotContext, `calendario-${date}-intento-${attempt}-despues-del-clic`);
          fares = await parseCalendarPrices(page, [date], "Salida", (summary) => onProgress?.({ phase, completed: index, total: candidateDates.length, current: summary }), 12, screenshotContext);
          await logFlightStep(screenshotContext, "Precio de ida leído", fares.some((item) => item.outboundDate === date) ? "success" : "warning", { date, attempt, fare: fares.find((item) => item.outboundDate === date) ?? null });
          await captureRunScreen(page, screenshotContext, `calendario-${date}-intento-${attempt}-lectura`);
          await closeCalendar(page, screenshotContext);
          if (!fares.some((item) => item.outboundDate === date) && attempt < 3) {
            onProgress?.({ phase: "Esperando actualización del precio", completed: index, total: candidateDates.length, current: `${date} · intento ${attempt}/3` });
            await page.waitForTimeout(1_000);
          }
        }
        const fare = fares.find((item) => item.outboundDate === date);
        if (fare) faresByDate.set(date, { ...fare, inboundDate: null });
        onProgress?.({ phase: "Fechas de ida revisadas", completed: index + 1, total: candidateDates.length, current: `${date}${fare ? ` · ${fare.amount ?? "sin precio"} ${fare.currency}` : " · sin precio legible"}` });
      }
      results.push(...candidateDates.flatMap((date) => faresByDate.has(date) ? [faresByDate.get(date)!] : []));
    } else {
      const pairs = validRoundTripPairs(followUp);
      let checkedPairs = 0;
      onProgress?.({ phase: "Seleccionando fechas de ida", completed: 0, total: pairs.length });
      if (pairs.length > MAX_COMBINATIONS) throw new Error(`El seguimiento genera ${pairs.length} combinaciones; el máximo inicial es ${MAX_COMBINATIONS}. Reduce los rangos o fija la estadía.`);
      if (!pairs.length) throw new Error("Los rangos no contienen una combinación válida de ida y vuelta con al menos una noche.");
      const outboundDates = [...new Set(pairs.map((pair) => pair.outboundDate))];
      for (const outboundDate of outboundDates) {
        const matchingPairs = pairs.filter((pair) => pair.outboundDate === outboundDate);
        const inboundDates = [...new Set(matchingPairs.map((pair) => pair.inboundDate))];
        onProgress?.({ phase: "Seleccionando fecha de ida", completed: checkedPairs, total: pairs.length, current: outboundDate });
        await openCalendar(page, "Salida");
        await captureRunScreen(page, screenshotContext, `calendario-salida-${outboundDate}`);
        await selectCalendarDate(page, outboundDate, screenshotContext);
        await assertSelectedDates(page, outboundDate, null, screenshotContext);
        await captureRunScreen(page, screenshotContext, `calendario-ida-seleccionada-${outboundDate}`);
        const returnPrices = new Map((await parseCalendarPrices(page, inboundDates, "Regreso", undefined, 12, screenshotContext)).map((fare) => [fare.outboundDate, fare]));
        await logFlightStep(screenshotContext, "Precios de regreso leídos", returnPrices.size ? "success" : "warning", { outboundDate, expectedDates: inboundDates, prices: [...returnPrices.values()].map(({ outboundDate: date, amount, currency }) => ({ date, amount, currency })) });
        await captureRunScreen(page, screenshotContext, `calendario-regresos-con-precios-${outboundDate}`);
        await closeCalendar(page, screenshotContext);
        for (const inboundDate of inboundDates) {
          const price = returnPrices.get(inboundDate);
          if (!price) continue;
          const nights = daysBetween(outboundDate, inboundDate) ?? 0;
          results.push({ ...price, outboundDate, inboundDate, details: price.currency === "COP" ? `Precio total indicado en el calendario para una estadía de ${nights} ${nights === 1 ? "noche" : "noches"}.` : "Se conserva la moneda sin conversión a COP." });
        }
        checkedPairs += matchingPairs.length;
        onProgress?.({ phase: "Validando precios totales", completed: checkedPairs, total: pairs.length, current: outboundDate });
      }
    }
    const thresholdResults = results.map((result) => ({ ...result, destinationIata: result.destinationIata ?? followUp.destinationIata, meetsThreshold: !result.isCalendarMinimum && result.amount !== null && result.amount <= followUp.maxPriceCop }));
    const qualifying = thresholdResults.filter((result) => result.meetsThreshold && result.amount !== null && result.currency === "COP");
    onProgress?.({ phase: "Buscando horarios", completed: 0, total: qualifying.length });
    for (let index = 0; index < qualifying.length; index++) {
      const result = qualifying[index];
      const detailed = await fetchFlightOptions(page, followUp, result, followUp.destinationIata, undefined, screenshotContext);
      const resultIndex = thresholdResults.indexOf(result);
      thresholdResults[resultIndex] = { ...detailed, destinationIata: detailed.destinationIata ?? followUp.destinationIata };
      onProgress?.({ phase: "Buscando horarios", completed: index + 1, total: qualifying.length, current: `${result.outboundDate}${result.inboundDate ? ` → ${result.inboundDate}` : ""}` });
    }
    onProgress?.({ phase: "Búsqueda terminada", completed: plannedTotal, total: plannedTotal });
    return thresholdResults;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Fallo desconocido al consultar Google Flights.");
  } finally {
    if (runId) flightBrowsers.delete(runId);
    if (runId) stoppedRunIds.delete(runId);
    await browser?.close().catch(() => undefined);
  }
}

export const googleFlightsUrl = FLIGHTS_URL;
