import { parsePrice } from "./prices";

export interface ParsedGoogleFlightCard {
  airline: string;
  logoUrl: string | null;
  operatedBy: string | null;
  departureTime: string;
  arrivalTime: string;
  amount: number;
  currency: string;
  stops: string | null;
  separateTickets: boolean;
}

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[\t\r]+/g, " ").replace(/ +/g, " ").trim();
}

function parseTimes(value: string) {
  const pattern = /\b(\d{1,2}:\d{2})\s*(a\s*\.?\s*m\.?|p\s*\.?\s*m\.?|AM|PM)/gi;
  return [...value.matchAll(pattern)].map((match) => `${match[1]} ${match[2].replace(/[\s.]/g, "").toLowerCase() === "am" ? "a. m." : "p. m."}`);
}

function parseAirline(accessibleLabel: string, lines: string[]) {
  const label = normalizeText(accessibleLabel);
  const labelMatch = label.match(/Vuelo\s+(?:sin escalas|con\s+[^.]+?)\s+de\s+(.+?)(?:\.|\s+Sale de\b)/i);
  const candidate = labelMatch?.[1] ?? lines.find((line) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(line) && !/boletos separados|directo|escala|kg\s*co2|emisiones|ida y vuelta|cop\s*\d|duraci[oó]n|operado por/i.test(line));
  if (!candidate) return { airline: "Aerolínea no identificada", operatedBy: null };
  const normalized = candidate.replace(/^Boletos separados\s*[·•-]?\s*/i, "").trim();
  const operator = normalized.match(/\s*Operado por\s+(.+)$/i);
  const airline = (operator ? normalized.slice(0, operator.index) : normalized).trim();
  return { airline: airline || "Aerolínea no identificada", operatedBy: operator?.[1]?.replace(/[.\s]+$/, "") ?? null };
}

export function parseGoogleFlightCard(accessibleLabel: string, visibleText: string, logoUrl: string | null = null): ParsedGoogleFlightCard | null {
  const normalizedLabel = normalizeText(accessibleLabel);
  const normalizedText = normalizeText(visibleText);
  const times = parseTimes(`${normalizedLabel}\n${normalizedText}`);
  const price = parsePrice(`${normalizedText} ${normalizedLabel}`);
  if (!price || times.length < 2) return null;

  const lines = visibleText.replace(/\u00a0/g, " ").split(/\n+/).map(normalizeText).filter(Boolean);
  const { airline, operatedBy } = parseAirline(normalizedLabel, lines);
  const stops = lines.find((line) => /^(?:Directo|\d+\s+escalas?)$/i.test(line)) ?? null;

  return {
    airline,
    logoUrl: logoUrl && /^https:\/\//i.test(logoUrl) ? logoUrl : null,
    operatedBy,
    departureTime: times[0],
    arrivalTime: times[1],
    amount: price.amount,
    currency: price.currency,
    stops,
    separateTickets: /boletos separados/i.test(`${normalizedLabel} ${normalizedText}`),
  };
}
