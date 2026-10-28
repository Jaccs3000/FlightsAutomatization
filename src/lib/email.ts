import type { FollowUp, FlightPriceResult } from "./types";
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

export function buildPriceAlertMessage(input: { followUp: FollowUp; results: FlightPriceResult[]; runTime: string }) {
  const { followUp, results, runTime } = input;
  const firstResult = results[0];
  const price = firstResult?.amount === null || firstResult?.amount === undefined
    ? "Precio no disponible"
    : `$ ${new Intl.NumberFormat("es-CO").format(firstResult.amount)}`;
  const adultLabel = `${followUp.adults} ${followUp.adults === 1 ? "adulto" : "adultos"}`;
  // EmailJS HTML-escapes `>` in template variables (`->` becomes `-&gt;`).
  const subject = `Vuelo ${followUp.originIata} → ${followUp.destinationIata} - ${firstResult ? formatSubjectDate(firstResult.outboundDate) : "Fecha"} - ${price} - ${adultLabel}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7f4;font-family:Arial,sans-serif;color:#17231e"><main style="max-width:760px;margin:28px auto;padding:28px;background:#fff;border:1px solid #e5ebe6;border-radius:18px"><div style="font-size:12px;color:#147a59;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Vuela · alerta de precio</div><h1 style="font-size:26px;margin:12px 0 4px">${escapeHtml(followUp.originIata)} → ${escapeHtml(followUp.destinationIata)}</h1><p style="color:#69766f;margin:0 0 22px">${escapeHtml(followUp.name)} · ${followUp.tripType === "round_trip" ? "Ida y vuelta" : "Solo ida"} · ${followUp.adults} adulto(s)</p><p>Encontré ${results.length} resultado(s) que cumplen tu límite de <strong>${new Intl.NumberFormat("es-CO").format(followUp.maxPriceCop)} COP</strong>.</p><table style="width:100%;border-collapse:collapse;text-align:left"><thead><tr><th style="padding:10px 12px;color:#69766f">Fechas</th><th style="padding:10px 12px;color:#69766f">Estadía</th><th style="padding:10px 12px;color:#69766f">Precio</th><th style="padding:10px 12px;color:#69766f">Dato leído</th></tr></thead><tbody>${buildRows(results)}</tbody></table><p style="margin:22px 0 8px"><a href="https://www.google.com/travel/flights?hl=es-419&amp;gl=CO&amp;curr=COP" style="display:inline-block;padding:11px 16px;border-radius:10px;background:#147a59;color:#fff;text-decoration:none;font-weight:700">Abrir Google Flights</a></p><p style="font-size:12px;color:#75817b">Precios observados el ${escapeHtml(runTime)}. Pueden cambiar y no incluyen necesariamente equipaje u otros cargos.</p></main></body></html>`;
  return { subject, html };
}

export async function sendPriceAlert(input: { recipient: string; followUp: FollowUp; results: FlightPriceResult[]; runTime: string }) {
  const message = buildPriceAlertMessage(input);
  await sendEmailJsMessage({ ...message, recipient: input.recipient });
}
