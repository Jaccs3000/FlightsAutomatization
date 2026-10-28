import type { FollowUp, FlightItineraryOption, FlightPriceResult } from "./types";
import { sendEmailJsMessage } from "./emailjs";

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

function buildRows(results: FlightPriceResult[]) {
  return results.map((result) => {
    const trip = result.inboundDate ? `${result.outboundDate} → ${result.inboundDate}` : result.outboundDate;
    const nights = result.inboundDate ? nightsBetween(result.outboundDate, result.inboundDate) : null;
    const stay = nights === null ? "Solo ida" : `${nights} ${nights === 1 ? "noche" : "noches"}`;
    const price = result.amount === null ? "Precio no disponible" : `${new Intl.NumberFormat("es-CO").format(result.amount)} ${result.currency ?? "COP"}`;
    const observed = [result.observedText, result.details].filter(Boolean).join(" · ");
    return `<tr><td style="padding:12px;border-bottom:1px solid #e7ece8">${escapeHtml(trip)}</td><td style="padding:12px;border-bottom:1px solid #e7ece8">${escapeHtml(stay)}</td><td style="padding:12px;border-bottom:1px solid #e7ece8;font-weight:700">${escapeHtml(price)}</td><td style="padding:12px;border-bottom:1px solid #e7ece8">${escapeHtml(observed)}</td></tr>`;
  }).join("");
}

function itineraryGroups(results: FlightPriceResult[]) {
  const groups = new Map<string, { amount: number; currency: string; airline: string; options: FlightItineraryOption[] }>();
  for (const result of results) for (const option of result.flightOptions ?? []) {
    const outboundAirline = option.outboundOperatedBy ? `${option.outboundAirline} (operado por ${option.outboundOperatedBy})` : option.outboundAirline;
    const inboundAirline = option.inboundOperatedBy ? `${option.inboundAirline} (operado por ${option.inboundOperatedBy})` : option.inboundAirline;
    const airline = inboundAirline && inboundAirline !== outboundAirline
      ? `${outboundAirline} (ida) / ${inboundAirline} (regreso)` : outboundAirline;
    const key = `${option.amount}|${option.currency}|${airline}`;
    const group = groups.get(key) ?? { amount: option.amount, currency: option.currency, airline, options: [] };
    group.options.push(option);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function formatLeg(date: string, departure: string, arrival: string) {
  return `${date} ${departure} - ${arrival}`;
}

function airlineLogo(url: string | null | undefined) {
  if (!url || !/^https:\/\//i.test(url)) return "";
  return `<img src="${escapeHtml(url)}" alt="" width="26" height="26" style="width:26px;height:26px;object-fit:contain;vertical-align:middle;margin-right:7px;border-radius:4px" />`;
}

function buildItinerarySection(results: FlightPriceResult[]) {
  const groups = itineraryGroups(results);
  const unavailable = results.some((result) => result.flightDetailsStatus === "unavailable");
  if (!groups.length && !unavailable) return "";
  const grouped = groups.map((group) => `<section style="margin:18px 0;padding:16px;border:1px solid #e2e9e4;border-radius:12px"><p style="margin:0 0 10px"><strong>Precio:</strong> $ ${new Intl.NumberFormat("es-CO").format(group.amount)} ${escapeHtml(group.currency)}<br><strong>Aerolínea:</strong> ${group.options.length ? `${airlineLogo(group.options[0].outboundLogoUrl)}${group.options[0].inboundAirline && group.options[0].inboundAirline !== group.options[0].outboundAirline ? airlineLogo(group.options[0].inboundLogoUrl) : ""}` : ""}${escapeHtml(group.airline)}</p>${group.options.map((option) => {
    const dates = results.find((result) => result.flightOptions?.includes(option));
    if (!dates) return "";
    const outbound = formatLeg(dates.outboundDate, option.outboundDepartureTime, option.outboundArrivalTime);
    const inbound = dates.inboundDate && option.inboundDepartureTime && option.inboundArrivalTime
      ? formatLeg(dates.inboundDate, option.inboundDepartureTime, option.inboundArrivalTime) : null;
    const outboundStops = option.outboundStops ? ` · ${option.outboundStops}` : "";
    const inboundStops = option.inboundStops ? ` · ${option.inboundStops}` : "";
    return `<p style="margin:8px 0">IDA: ${airlineLogo(option.outboundLogoUrl)}<strong>${escapeHtml(option.outboundAirline)}</strong> · ${escapeHtml(outbound)}${escapeHtml(outboundStops)}${inbound ? `<br>REGRESO: ${airlineLogo(option.inboundLogoUrl)}<strong>${escapeHtml(option.inboundAirline ?? option.outboundAirline)}</strong> · ${escapeHtml(inbound)}${escapeHtml(inboundStops)}` : ""}${option.separateTickets ? `<br><strong>Incluye boletos separados.</strong>` : ""}</p>`;
  }).join("")}</section>`).join("");
  const fallback = unavailable ? `<p style="padding:12px;background:#fff8e8;border-radius:10px">Google Flights mostró el precio indicado en el calendario, pero no fue posible cargar el detalle de horarios. Precio(s) del calendario: ${results.filter((item) => item.flightDetailsStatus === "unavailable").map((item) => `$ ${new Intl.NumberFormat("es-CO").format(item.amount ?? 0)} COP (${item.outboundDate}${item.inboundDate ? ` / ${item.inboundDate}` : ""})`).join("; ")}.</p>` : "";
  return `<h2 style="font-size:19px;margin:26px 0 10px">Opciones de vuelo</h2>${grouped}${fallback}`;
}

export function buildPriceAlertMessage(input: { followUp: FollowUp; results: FlightPriceResult[]; runTime: string }) {
  const { followUp, results, runTime } = input;
  const firstResult = results[0];
  const price = firstResult?.amount === null || firstResult?.amount === undefined
    ? "Precio no disponible"
    : `$ ${new Intl.NumberFormat("es-CO").format(firstResult.amount)}`;
  const adultLabel = `${followUp.adults} ${followUp.adults === 1 ? "adulto" : "adultos"}`;
  // EmailJS HTML-escapes `>` in template variables (`->` becomes `-&gt;`).
  const subject = `Vuelo ${followUp.originIata} → ${followUp.destinationIata} - ${firstResult ? formatSubjectDate(firstResult.outboundDate) : "Fecha"} - ${price} - ${adultLabel}`;
  const details = buildItinerarySection(results);
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7f4;font-family:Arial,sans-serif;color:#17231e"><main style="max-width:760px;margin:28px auto;padding:28px;background:#fff;border:1px solid #e5ebe6;border-radius:18px"><div style="font-size:12px;color:#147a59;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Vuela · alerta de precio</div><h1 style="font-size:26px;margin:12px 0 4px">${escapeHtml(followUp.originIata)} → ${escapeHtml(followUp.destinationIata)}</h1><p style="color:#69766f;margin:0 0 22px">${escapeHtml(followUp.name)} · ${followUp.tripType === "round_trip" ? "Ida y vuelta" : "Solo ida"} · ${followUp.adults} adulto(s)</p><p>Encontré ${results.length} resultado(s) que cumplen tu límite de <strong>${new Intl.NumberFormat("es-CO").format(followUp.maxPriceCop)} COP</strong>.</p><table style="width:100%;border-collapse:collapse;text-align:left"><thead><tr><th style="padding:10px 12px;color:#69766f">Fechas</th><th style="padding:10px 12px;color:#69766f">Estadía</th><th style="padding:10px 12px;color:#69766f">Precio</th><th style="padding:10px 12px;color:#69766f">Dato leído</th></tr></thead><tbody>${buildRows(results)}</tbody></table>${details}<p style="margin:22px 0 8px"><a href="https://www.google.com/travel/flights?hl=es-419&amp;gl=CO&amp;curr=COP" style="display:inline-block;padding:11px 16px;border-radius:10px;background:#147a59;color:#fff;text-decoration:none;font-weight:700">Abrir Google Flights</a></p><p style="font-size:12px;color:#75817b">Precios observados el ${escapeHtml(runTime)}. Pueden cambiar y no incluyen necesariamente equipaje u otros cargos.</p></main></body></html>`;
  return { subject, html };
}

export async function sendPriceAlert(input: { recipient: string; followUp: FollowUp; results: FlightPriceResult[]; runTime: string }) {
  const message = buildPriceAlertMessage(input);
  await sendEmailJsMessage({ ...message, recipient: input.recipient });
}
