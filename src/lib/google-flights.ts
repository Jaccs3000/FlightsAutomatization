import { chromium, type Browser, type Page } from "playwright";
import type { FlightPriceResult, FollowUp } from "./types";
import { dateRange, validRoundTripPairs } from "./dates";
import { parsePrice } from "./prices";

const FLIGHTS_URL = "https://www.google.com/travel/flights?hl=es-419&gl=CO&curr=COP";
export const MAX_COMBINATIONS = 50;


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

async function parseCalendarPrices(page: Page, targets: string[], field: "Salida" | "Regreso"): Promise<FlightPriceResult[]> {
  const dialog = await openCalendar(page, field);
  const output = new Map<string, FlightPriceResult>();
  // Google shows two calendar months at once. A 31-day range beginning at
  // the end of a month can extend into a third month, so collect each visible
  // month before deciding that a date has no price.
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
    const cells = await dialog.locator("[role='button']").evaluateAll((items) => items.map((item) => {
      const label = item.querySelector("[aria-label]")?.getAttribute("aria-label") ?? "";
      return { label, text: item.textContent ?? "" };
    }));
    for (const target of targets) {
      if (output.has(target)) continue;
      const cell = cells.find((item) => item.label.startsWith(calendarDateLabel(target)));
      if (!cell) continue;
      const price = parsePrice(cell.text);
      if (price) output.set(target, { outboundDate: target, inboundDate: null, amount: price.amount, currency: price.currency, comparable: price.currency === "COP", meetsThreshold: false, observedText: cell.text.trim(), details: price.currency === "COP" ? null : "El calendario mostr\u00f3 una moneda distinta de COP; se conserva en el historial sin conversi\u00f3n." });
    }
    const visibleDates = new Set(targets.filter((target) => cells.some((item) => item.label.startsWith(calendarDateLabel(target)))));
    if (visibleDates.size === targets.length || pageIndex === 2) break;
    const next = page.getByRole("button", { name: /^siguiente$/i }).last();
    if (!(await next.count()) || !(await next.isVisible().catch(() => false))) break;
    await next.click();
    await page.waitForTimeout(180);
  }
  return [...output.values()];
}

async function openCalendar(page: Page, field: "Salida" | "Regreso" = "Salida") {
  const currentDialog = page.getByRole("dialog").last();
  if (await currentDialog.count() && await currentDialog.isVisible().catch(() => false)) {
    await page.waitForTimeout(1_500);
    return currentDialog;
  }
  const input = page.getByPlaceholder(field, { exact: true }).first();
  if (!(await input.count())) throw new Error(`No aparece el campo ${field} en Google Flights.`);
  await input.click();
  await page.waitForTimeout(1_500);
  return page.getByRole("dialog").last();
}

async function closeCalendar(page: Page) {
  const done = page.getByRole("button", { name: /^listo$/i }).last();
  if (await done.count() && await done.isVisible().catch(() => false)) await done.click();
}

function calendarDateLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

async function selectCalendarDate(page: Page, date: string) {
  const day = page.locator(`[aria-label=${JSON.stringify(calendarDateLabel(date))}]`).first();
  await day.waitFor({ state: "visible", timeout: 12_000 });
  await day.click();
  await page.waitForTimeout(1_500);
}

async function setAirport(page: Page, label: RegExp, code: string) {
  await chooseAirport(page, label, code);
}

async function prepareForm(page: Page, followUp: FollowUp) {
  await chooseTripType(page, followUp.tripType);
  await setAirport(page, /¿Desde dónde\?/i, followUp.originIata);
  await setAirport(page, /¿A dónde quieres ir\?/i, followUp.destinationIata);
  await chooseAdults(page, followUp.adults);
}

export async function scanGoogleFlights(followUp: FollowUp): Promise<FlightPriceResult[]> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: "es-CO", timezoneId: "America/Bogota", viewport: { width: 1440, height: 1050 } });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.goto(FLIGHTS_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("combobox", { name: /¿Desde dónde\?/i }).waitFor({ state: "visible", timeout: 20_000 });
    await prepareForm(page, followUp);
    const results: FlightPriceResult[] = [];
    if (followUp.tripType === "one_way") {
      const dates = dateRange(followUp.outboundMode, followUp.outboundStart, followUp.outboundEnd);
      for (const date of dates.length ? dates : [followUp.outboundStart]) {
        await closeCalendar(page);
        await openCalendar(page, "Salida");
        await selectCalendarDate(page, date);
        results.push(...await parseCalendarPrices(page, [date], "Salida"));
      }
      await closeCalendar(page);
    } else {
      const pairs = validRoundTripPairs(followUp);
      if (pairs.length > MAX_COMBINATIONS) throw new Error(`El seguimiento genera ${pairs.length} combinaciones; el máximo inicial es ${MAX_COMBINATIONS}. Reduce los rangos o fija la estadía.`);
      if (!pairs.length) throw new Error("Los rangos no contienen una combinación válida de ida y vuelta con al menos una noche.");
      for (const pair of pairs) {
        await closeCalendar(page);
        await openCalendar(page, "Salida");
        await selectCalendarDate(page, pair.outboundDate);
        await selectCalendarDate(page, pair.inboundDate);
        const price = (await parseCalendarPrices(page, [pair.inboundDate], "Regreso"))[0];
        if (price) {
          const nights = Number((new Date(`${pair.inboundDate}T00:00:00Z`).valueOf() - new Date(`${pair.outboundDate}T00:00:00Z`).valueOf()) / 86_400_000);
          results.push({ ...price, outboundDate: pair.outboundDate, inboundDate: pair.inboundDate, details: price.currency === "COP" ? `Precio total indicado en el calendario para una estadía de ${nights} ${nights === 1 ? "noche" : "noches"}.` : "Se conserva la moneda sin conversión a COP." });
        }
      }
      await closeCalendar(page);
    }
    return results.map((result) => ({ ...result, meetsThreshold: result.amount !== null && result.amount <= followUp.maxPriceCop }));
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Fallo desconocido al consultar Google Flights.");
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export const googleFlightsUrl = FLIGHTS_URL;
