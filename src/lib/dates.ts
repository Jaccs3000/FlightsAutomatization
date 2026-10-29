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

function addDays(value: string, amount: number): string {
  const date = parseIsoDate(value)!;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function easterSunday(year: number): string {
  // Gregorian computus (Meeus/Jones/Butcher).
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nextMonday(value: string): string {
  const day = parseIsoDate(value)!.getUTCDay();
  return addDays(value, day === 1 ? 0 : day === 0 ? 1 : 8 - day);
}

/** Colombian national non-working holidays under Law 51 of 1983 (Ley Emiliani). */
export function colombianNationalHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (month: number, day: number, moveToMonday = false) => {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    holidays.add(moveToMonday ? nextMonday(date) : date);
  };
  // Fixed holidays not moved by Ley Emiliani.
  add(1, 1); add(5, 1); add(7, 20); add(8, 7); add(12, 8); add(12, 25);
  // Holidays moved to the following Monday when not already Monday.
  add(1, 6, true); add(3, 19, true); add(6, 29, true); add(7, 9, true); add(8, 15, true);
  add(10, 12, true); add(11, 1, true); add(11, 11, true);
  const easter = easterSunday(year);
  holidays.add(addDays(easter, -3)); // Jueves Santo
  holidays.add(addDays(easter, -2)); // Viernes Santo
  holidays.add(nextMonday(addDays(easter, 39))); // Ascensión
  holidays.add(nextMonday(addDays(easter, 60))); // Corpus Christi
  holidays.add(nextMonday(addDays(easter, 68))); // Sagrado Corazón
  return holidays;
}

export function isColombianMondayHoliday(date: string): boolean {
  return parseIsoDate(date)?.getUTCDay() === 1 && colombianNationalHolidays(Number(date.slice(0, 4))).has(date);
}

export interface WeekendEscapePair { outboundDate: string; inboundDate: string; outboundWindow: "friday_evening" | "saturday_morning"; inboundWindow: "sunday_evening" | "monday_holiday_evening" }

/** Generates Friday/Saturday departures paired with Sunday and, for holiday weekends, Monday returns. */
export function weekendEscapePairs(from: string, lookaheadDays: number): WeekendEscapePair[] {
  const start = parseIsoDate(from);
  if (!start || !Number.isInteger(lookaheadDays) || lookaheadDays < 1) return [];
  const end = addDays(from, lookaheadDays);
  const pairs: WeekendEscapePair[] = [];
  for (let date = from; date <= end; date = addDays(date, 1)) {
    const weekday = parseIsoDate(date)!.getUTCDay();
    if (weekday !== 5 && weekday !== 6) continue;
    const sunday = addDays(date, weekday === 5 ? 2 : 1);
    pairs.push({ outboundDate: date, inboundDate: sunday, outboundWindow: weekday === 5 ? "friday_evening" : "saturday_morning", inboundWindow: "sunday_evening" });
    const monday = addDays(sunday, 1);
    if (isColombianMondayHoliday(monday)) pairs.push({ outboundDate: date, inboundDate: monday, outboundWindow: weekday === 5 ? "friday_evening" : "saturday_morning", inboundWindow: "monday_holiday_evening" });
  }
  return pairs;
}

export function weekendEscapeCandidates(destinations: string[], from: string, lookaheadDays: number, limit = 200): Array<WeekendEscapePair & { destinationIata: string }> {
  const uniqueDestinations = [...new Set(destinations.map((value) => value.trim().toUpperCase()).filter(Boolean))];
  const candidates = uniqueDestinations.flatMap((destinationIata, destinationOrder) => weekendEscapePairs(from, lookaheadDays).map((pair) => ({ ...pair, destinationIata, destinationOrder })));
  return candidates
    .sort((left, right) => left.outboundDate.localeCompare(right.outboundDate) || left.destinationOrder - right.destinationOrder || left.inboundDate.localeCompare(right.inboundDate))
    .slice(0, Math.max(0, Math.trunc(limit)))
    .map(({ destinationOrder: _destinationOrder, ...candidate }) => candidate);
}
