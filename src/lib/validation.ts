import { z } from "zod";
import { daysBetween, dateRange, parseIsoDate } from "./dates";

const isoDate = z.string().refine((value) => parseIsoDate(value) !== null, "Usa una fecha válida.");
const iata = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Ingresa un código IATA de tres letras.");

function bogotaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const followUpSchema = z.object({
  name: z.string().trim().min(1, "Escribe un nombre para el seguimiento.").max(80),
  originIata: iata,
  destinationIata: iata,
  tripType: z.enum(["one_way", "round_trip"]),
  outboundMode: z.enum(["exact", "flexible"]),
  outboundStart: isoDate,
  outboundEnd: isoDate.nullable().optional(),
  inboundMode: z.enum(["exact", "flexible"]).nullable().optional(),
  inboundStart: isoDate.nullable().optional(),
  inboundEnd: isoDate.nullable().optional(),
  stayNights: z.number().int().min(1).max(365).nullable().optional(),
  adults: z.number().int().min(1).max(9),
  maxPriceCop: z.number().int().min(1).max(2_000_000_000),
  status: z.enum(["active", "paused"]),
}).superRefine((value, context) => {
  if (value.originIata === value.destinationIata) {
    context.addIssue({ code: "custom", path: ["destinationIata"], message: "El origen y el destino deben ser diferentes." });
  }
  const today = bogotaToday();
  const maxDate = new Date(`${today}T12:00:00Z`);
  maxDate.setUTCDate(maxDate.getUTCDate() + 365);
  const latest = maxDate.toISOString().slice(0, 10);
  for (const [label, dates, path] of [
    ["salida", dateRange(value.outboundMode, value.outboundStart, value.outboundEnd), "outboundStart"],
    ...(value.tripType === "round_trip" && value.inboundMode && value.inboundStart ? [["regreso", dateRange(value.inboundMode, value.inboundStart, value.inboundEnd), "inboundStart"] as const] : []),
  ] as Array<[string, string[], string]>) {
    if (dates.some((date) => date < today)) context.addIssue({ code: "custom", path: [path], message: `La fecha de ${label} no puede estar en el pasado.` });
    if (dates.some((date) => date > latest)) context.addIssue({ code: "custom", path: [path], message: "La primera versión permite fechas hasta 365 días hacia adelante." });
  }
  const checkRange = (mode: "exact" | "flexible", start: string, end: string | null | undefined, path: string) => {
    if (mode === "exact") return;
    if (!end) {
      context.addIssue({ code: "custom", path: [path], message: "Selecciona el último día del rango." });
      return;
    }
    const length = daysBetween(start, end);
    if (length === null || length < 0 || length > 30) {
      context.addIssue({ code: "custom", path: [path], message: "El rango puede abarcar hasta 31 fechas consecutivas." });
    }
  };
  checkRange(value.outboundMode, value.outboundStart, value.outboundEnd, "outboundEnd");

  if (value.tripType === "round_trip") {
    if (!value.inboundMode || !value.inboundStart) {
      context.addIssue({ code: "custom", path: ["inboundStart"], message: "Configura la fecha de regreso." });
    } else {
      checkRange(value.inboundMode, value.inboundStart, value.inboundEnd, "inboundEnd");
      const outboundDates = dateRange(value.outboundMode, value.outboundStart, value.outboundEnd);
      const inboundDates = dateRange(value.inboundMode, value.inboundStart, value.inboundEnd);
      if (value.stayNights !== null && value.stayNights !== undefined) {
        const hasPair = outboundDates.some((departure) => inboundDates.some((arrival) => daysBetween(departure, arrival) === value.stayNights));
        if (!hasPair) context.addIssue({ code: "custom", path: ["stayNights"], message: "No hay fechas en esos rangos con esa duración." });
      } else {
        const hasPair = outboundDates.some((departure) => inboundDates.some((arrival) => {
          const nights = daysBetween(departure, arrival);
          return nights !== null && nights >= 1;
        }));
        if (!hasPair) context.addIssue({ code: "custom", path: ["inboundStart"], message: "Los rangos deben permitir al menos una noche de estadía." });
      }
      const combinations = outboundDates.reduce((total, departure) => total + inboundDates.filter((arrival) => {
        const nights = daysBetween(departure, arrival);
        return nights !== null && nights >= 1 && (value.stayNights == null || nights === value.stayNights);
      }).length, 0);
      if (combinations > 50) context.addIssue({ code: "custom", path: ["stayNights"], message: "En esta versión se permiten hasta 50 combinaciones de ida y vuelta por seguimiento." });
    }
  }
});

export type FollowUpFormValues = z.infer<typeof followUpSchema>;

export const settingsSchema = z.object({
  recipientEmail: z.union([z.literal(""), z.email()]),
  senderEmail: z.union([z.literal(""), z.email()]).nullable(),
  scheduleTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(12),
  historyRetentionDays: z.number().int().min(1).max(3650),
  schedulerEnabled: z.boolean(),
}).superRefine((value, context) => {
  if (new Set(value.scheduleTimes).size !== value.scheduleTimes.length) {
    context.addIssue({ code: "custom", path: ["scheduleTimes"], message: "No repitas una hora." });
  }
});
