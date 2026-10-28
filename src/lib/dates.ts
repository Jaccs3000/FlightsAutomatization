import type { DateMode, FollowUpInput } from "./types";

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

export function daysBetween(start: string, end: string): number | null {
  const left = parseIsoDate(start);
  const right = parseIsoDate(end);
  if (!left || !right) return null;
  return Math.round((right.valueOf() - left.valueOf()) / 86_400_000);
}

export function dateRange(mode: DateMode, start: string, end: string | null | undefined): string[] {
  if (mode === "exact") return [start];
  if (!end) return [];
  const count = daysBetween(start, end);
  if (count === null || count < 0 || count > 31) return [];
  return Array.from({ length: count + 1 }, (_, index) => {
    const date = parseIsoDate(start)!;
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

export function validRoundTripPairs(input: FollowUpInput): Array<{ outboundDate: string; inboundDate: string }> {
  if (input.tripType !== "round_trip" || !input.inboundMode || !input.inboundStart) return [];
  const outbound = dateRange(input.outboundMode, input.outboundStart, input.outboundEnd);
  const inbound = dateRange(input.inboundMode, input.inboundStart, input.inboundEnd);
  const pairs: Array<{ outboundDate: string; inboundDate: string }> = [];
  for (const outboundDate of outbound) {
    for (const inboundDate of inbound) {
      const nights = daysBetween(outboundDate, inboundDate);
      if (nights === null || nights < 1) continue;
      if (input.stayNights !== null && input.stayNights !== undefined && nights !== input.stayNights) continue;
      pairs.push({ outboundDate, inboundDate });
    }
  }
  return pairs;
}

export function maxIsoDate(daysAhead = 365, now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}
