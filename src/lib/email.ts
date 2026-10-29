import type { FollowUp, FlightItineraryOption, FlightPriceResult } from "./types";
import { sendEmailJsMessage } from "./emailjs";

import { emailJsPayloadBytes } from "./emailjs-size";

const EMAIL_PART_LIMIT_BYTES = 45_000;
const EMAIL_PART_TARGET_BYTES = 44_000;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function nightsBetween(outbound: string, inbound: string) {
  return Math.round((new Date(`${inbound}T00:00:00Z`).valueOf() - new Date(`${outbound}T00:00:00Z`).valueOf()) / 86_400_000);
}

function formatSubjectDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]}`;
}

function formatConfiguredDate(value: string, mode: FollowUp["outboundMode"]) {
  const date = formatSubjectDate(value);
  return mode === "exact" ? `${date} ${value.slice(0, 4)}` : date;
}

function formatConfiguredDateRange(mode: FollowUp["outboundMode"], start: string, end: string | null) {
  const first = formatConfiguredDate(start, mode);
  return mode === "flexible" && end ? `${first} – ${formatConfiguredDate(end, mode)}` : first;
}

function configuredDatesText(followUp: FollowUp) {
  if (followUp.mode === "weekend_escape") return `Período de búsqueda: próximos ${followUp.lookaheadDays ?? 120} días.`;
  const outbound = formatConfiguredDateRange(followUp.outboundMode, followUp.outboundStart, followUp.outboundEnd);
  if (followUp.tripType === "one_way") return `Fecha(s) de ida: ${outbound}.`;
  const inbound = followUp.inboundStart
    ? formatConfiguredDateRange(followUp.inboundMode ?? "exact", followUp.inboundStart, followUp.inboundEnd)
    : "sin configurar";
  return `Fechas configuradas: ida ${outbound} · regreso ${inbound}.`;
}

function buildRows(results: FlightPriceResult[], includeDestination: boolean) {
  return results.map((result) => {
    const trip = result.inboundDate ? `${result.outboundDate} → ${result.inboundDate}` : result.outboundDate;
    const nights = result.inboundDate ? nightsBetween(result.outboundDate, result.inboundDate) : null;
    const stay = nights === null ? "Solo ida" : `${nights} ${nights === 1 ? "noche" : "noches"}`;
    const price = result.amount === null ? "Precio no disponible" : `${new Intl.NumberFormat("es-CO").format(result.amount)} ${result.currency ?? "COP"}`;
    const safeDetails = result.details?.split(/\s*No se pudo obtener el detalle de vuelos:/i)[0]?.trim();
    const observed = [result.observedText, safeDetails].filter(Boolean).join(" · ");
    const destination = includeDestination ? `<td style="padding:12px;border-bottom:1px solid #e7ece8">${escapeHtml(result.destinationIata ?? "")}</td>` : "";
    return `<tr>${destination}<td style="padding:12px;border-bottom:1px solid #e7ece8">${escapeHtml(trip)}</td><td style="padding:12px;border-bottom:1px solid #e7ece8">${escapeHtml(stay)}</td><td style="padding:12px;border-bottom:1px solid #e7ece8;font-weight:700">${escapeHtml(price)}</td><td style="padding:12px;border-bottom:1px solid #e7ece8">${escapeHtml(observed)}</td></tr>`;
  }).join("");
}

function itineraryGroups(results: FlightPriceResult[]) {
  const groups = new Map<string, { amount: number; currency: string; airline: string; destination: string; options: Array<{ option: FlightItineraryOption; result: FlightPriceResult }> }>();
  for (const result of results) for (const option of result.flightOptions ?? []) {
    const outboundAirline = option.outboundOperatedBy ? `${option.outboundAirline} (operado por ${option.outboundOperatedBy})` : option.outboundAirline;
    const inboundAirline = option.inboundOperatedBy ? `${option.inboundAirline} (operado por ${option.inboundOperatedBy})` : option.inboundAirline;
    const airline = inboundAirline && inboundAirline !== outboundAirline
      ? `${outboundAirline} (ida) / ${inboundAirline} (regreso)` : outboundAirline;
    const destination = result.destinationIata ?? "";
    const key = `${destination}|${option.amount}|${option.currency}|${airline}`;
    const group = groups.get(key) ?? { amount: option.amount, currency: option.currency, airline, destination, options: [] };
    group.options.push({ option, result });
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    left.amount - right.amount || left.currency.localeCompare(right.currency) ||
    left.destination.localeCompare(right.destination) || left.airline.localeCompare(right.airline));
}

function formatDeparture(date: string, time: string) {
  const compactTime = time.replace(/\s*a\.\s*m\.?/i, " am").replace(/\s*p\.\s*m\.?/i, " pm").trim();
  return `${formatSubjectDate(date)} ${compactTime}`;
}

function departureMinutes(value: string) {
  const match = value.match(/(\d{1,2}):(\d{2})\s*([ap])/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const hour = Number(match[1]) % 12 + (match[3].toLowerCase() === "p" ? 12 : 0);
  return hour * 60 + Number(match[2]);
}

const commonAirlineCodes: Array<[RegExp, string]> = [
  [/avianca/i, "AV"], [/jetsmart/i, "JA"], [/latam/i, "LA"], [/wingo/i, "P5"],
  [/copa/i, "CM"], [/american airlines/i, "AA"], [/delta/i, "DL"], [/united airlines/i, "UA"],
  [/iberia/i, "IB"], [/air europa/i, "UX"], [/air france/i, "AF"], [/klm/i, "KL"],
  [/lufthansa/i, "LH"], [/british airways/i, "BA"],
];

function airlineLogoSource(url: string | null | undefined, airline: string) {
  // Google also places arrow/navigation icons inside flight cards. Keep only
  // actual airline-logo assets; use Google's logo catalog for known carriers.
  if (url && /^https:\/\/www\.gstatic\.com\/flights\/airline[_-]logos?\/[A-Za-z0-9/_-]+\.png$/i.test(url)) return url;
  const code = commonAirlineCodes.find(([pattern]) => pattern.test(airline))?.[1];
  return code ? `https://www.gstatic.com/flights/airline_logos/70px/${code}.png` : null;
}

function airlineMark(url: string | null | undefined, airline: string) {
  const source = airlineLogoSource(url, airline);
  const code = source?.match(/\/([A-Za-z0-9]+)\.png$/)?.[1] ?? airline;
  return source
    // Email clients commonly strip <style> blocks and CSS background images.
    // Use a regular image with dimensions so Gmail renders the carrier mark.
    ? `<img src=${escapeHtml(source)} width=16 alt=${escapeHtml(code)}>`
    : `<span>${escapeHtml(airline)}</span>`;
}

function buildItinerarySection(results: FlightPriceResult[], includeDestination = false) {
  const groups = itineraryGroups(results);
  const unavailable = results.some((result) => result.flightDetailsStatus === "unavailable");
  if (!groups.length && !unavailable) return "";
  const grouped = groups.map((group, index) => {
    const options = [...group.options]
      .sort((left, right) => left.result.outboundDate.localeCompare(right.result.outboundDate)
        || departureMinutes(left.option.outboundDepartureTime) - departureMinutes(right.option.outboundDepartureTime))
      .map(({ option, result: dates }) => {
        const outbound = formatDeparture(dates.outboundDate, option.outboundDepartureTime);
        const inbound = dates.inboundDate && option.inboundDepartureTime
          ? formatDeparture(dates.inboundDate, option.inboundDepartureTime) : null;
        const outboundLeg = `${airlineMark(option.outboundLogoUrl, option.outboundAirline)} ${escapeHtml(outbound)}`;
        const inboundLeg = inbound ? `${airlineMark(option.inboundLogoUrl, option.inboundAirline ?? option.outboundAirline)} ${escapeHtml(inbound)}` : "";
        return `<div style="margin:6px 0;white-space:nowrap">${outboundLeg} &nbsp;→&nbsp; ${inboundLeg}${option.separateTickets ? ` <span style="font-size:11px;color:#75817b">· Boletos separados</span>` : ""}</div>`;
      }).join("");
    const heading = `<p style="margin:8px 0 4px;font-weight:700;color:#17231e">${includeDestination && group.destination ? `${escapeHtml(group.destination)} · ` : ""}$ ${new Intl.NumberFormat("es-CO").format(group.amount)}</p>`;
    const separator = index < groups.length - 1 ? `<br>` : "";
    return `${heading}${options}${separator}`;
  }).join("");
  const fallback = unavailable ? `<p style="padding:12px;background:#fff8e8;border-radius:10px">Google Flights mostró el precio del calendario, pero no entregó el detalle de horarios para esta búsqueda. Se conservan estos resultados: ${results.filter((item) => item.flightDetailsStatus === "unavailable").map((item) => `$ ${new Intl.NumberFormat("es-CO").format(item.amount ?? 0)} COP (${formatSubjectDate(item.outboundDate)}${item.inboundDate ? ` → ${formatSubjectDate(item.inboundDate)}` : ""})`).join("; ")}.</p>` : "";
  return `<h2 style="font-size:19px;margin:20px 0 10px">Opciones de vuelo</h2>${groups.length ? `<p style="margin:0 0 10px;font-weight:700">IDA　→　REGRESO</p>` : ""}${grouped}${fallback}`;
}

export function buildPriceAlertMessage(input: { followUp: FollowUp; results: FlightPriceResult[]; runTime: string }) {
  const { followUp, results, runTime } = input;
  const firstResult = results[0];
  const price = firstResult?.amount === null || firstResult?.amount === undefined
    ? "Precio no disponible"
    : `$ ${new Intl.NumberFormat("es-CO").format(firstResult.amount)}`;
  const adultLabel = `${followUp.adults} ${followUp.adults === 1 ? "adulto" : "adultos"}`;
  // EmailJS HTML-escapes `>` in template variables (`->` becomes `-&gt;`).
  const subject = followUp.mode === "weekend_escape"
    ? `Escape fin de semana ${followUp.originIata} → ${[...new Set(results.map((result) => result.destinationIata).filter(Boolean))].join(", ")} - ${price} - ${adultLabel}`
    : `Vuelo ${followUp.originIata} → ${followUp.destinationIata} - ${firstResult ? formatSubjectDate(firstResult.outboundDate) : "Fecha"} - ${price} - ${adultLabel}`;
  const details = buildItinerarySection(results, followUp.mode === "weekend_escape");
  const routeLabel = followUp.mode === "weekend_escape" ? `${followUp.originIata} → ${[...new Set(results.map((result) => result.destinationIata).filter(Boolean))].join(", ")}` : `${followUp.originIata} → ${followUp.destinationIata}`;
  const destinationColumn = followUp.mode === "weekend_escape" ? `<th style="padding:10px 12px;color:#69766f">Destino</th>` : "";
  const summaryResults = results.filter((result) => !result.flightOptions?.length);
  const summaryTable = summaryResults.length ? `<table style="width:100%;border-collapse:collapse;text-align:left;font-size:13px;margin:16px 0 22px"><thead><tr>${destinationColumn}<th style="padding:10px 12px;border-bottom:1px solid #e7ece8;color:#536259">Fechas</th><th style="padding:10px 12px;border-bottom:1px solid #e7ece8;color:#536259">Estadía</th><th style="padding:10px 12px;border-bottom:1px solid #e7ece8;color:#536259">Precio</th><th style="padding:10px 12px;border-bottom:1px solid #e7ece8;color:#536259">Dato leído</th></tr></thead><tbody>${buildRows([...summaryResults].sort((a, b) => (a.amount ?? Number.MAX_SAFE_INTEGER) - (b.amount ?? Number.MAX_SAFE_INTEGER)), followUp.mode === "weekend_escape")}</tbody></table>` : "";
  const resultCount = new Set(results.map((result) => `${result.destinationIata ?? ""}|${result.outboundDate}|${result.inboundDate ?? ""}|${result.amount ?? ""}`)).size;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7f4;font:14px Arial,sans-serif;color:#17231e"><main style="max-width:760px;margin:20px auto;padding:22px;background:#fff"><div style="font-size:12px;color:#147a59;font-weight:bold">VUELA · ALERTA DE PRECIO</div><h1 style="font-size:24px">${escapeHtml(routeLabel)}</h1><p>${escapeHtml(followUp.name)} · ${followUp.mode === "weekend_escape" ? "Escape fin de semana" : followUp.tripType === "round_trip" ? "Ida y vuelta" : "Solo ida"} · ${followUp.adults} adulto(s)</p><p>${resultCount} resultado(s) bajo el límite de <b>${new Intl.NumberFormat("es-CO").format(followUp.maxPriceCop)} COP</b>.</p><p>${escapeHtml(configuredDatesText(followUp))}</p>${summaryTable}${details}<p><a href="https://www.google.com/travel/flights?hl=es-419&amp;gl=CO&amp;curr=COP">Abrir Google Flights</a></p><p style="font-size:12px;color:#75817b">Precios observados el ${escapeHtml(runTime)}. Pueden cambiar y no incluyen necesariamente equipaje u otros cargos.</p></main></body></html>`;
  return { subject, html };
}

function splitFlightResults(results: FlightPriceResult[]) {
  return results.flatMap((result) => result.flightOptions?.length
    ? result.flightOptions.map((option) => ({ ...result, flightOptions: [option] }))
    : [result]);
}

function measuredMessageSize(recipient: string, message: { subject: string; html: string }) {
  return emailJsPayloadBytes({ to_email: recipient, subject: message.subject, html_body: message.html });
}

export function buildPriceAlertMessages(input: { recipient: string; followUp: FollowUp; results: FlightPriceResult[]; runTime: string }) {
  const single = buildPriceAlertMessage(input);
  if (measuredMessageSize(input.recipient, single) < EMAIL_PART_LIMIT_BYTES) return [single];

  const entries = splitFlightResults(input.results).sort((left, right) =>
    (left.flightOptions?.[0]?.amount ?? left.amount ?? Number.MAX_SAFE_INTEGER)
      - (right.flightOptions?.[0]?.amount ?? right.amount ?? Number.MAX_SAFE_INTEGER)
    || left.outboundDate.localeCompare(right.outboundDate)
    || departureMinutes(left.flightOptions?.[0]?.outboundDepartureTime ?? "")
      - departureMinutes(right.flightOptions?.[0]?.outboundDepartureTime ?? ""));
  const chunks: FlightPriceResult[][] = [];
  let current: FlightPriceResult[] = [];
  for (const entry of entries) {
    const candidate = [...current, entry];
    const message = buildPriceAlertMessage({ ...input, results: candidate });
    if (current.length && measuredMessageSize(input.recipient, message) > EMAIL_PART_TARGET_BYTES) {
      chunks.push(current);
      current = [entry];
    } else {
      current = candidate;
    }
  }
  if (current.length) chunks.push(current);

  const total = chunks.length;
  return chunks.map((results, index) => {
    const message = buildPriceAlertMessage({ ...input, results });
    const part = `PARTE ${index + 1}/${total}`;
    return {
      subject: `${message.subject} · ${part}`,
      html: message.html.replace(/(<main\b[^>]*>)/, `$1<p><b>${part}</b></p>`),
    };
  });
}

export async function sendPriceAlert(input: { recipient: string; followUp: FollowUp; results: FlightPriceResult[]; runTime: string }) {
  const messages = buildPriceAlertMessages(input);
  for (const message of messages) await sendEmailJsMessage({ ...message, recipient: input.recipient });
}
