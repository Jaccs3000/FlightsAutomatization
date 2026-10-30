function normalizeCalendarDateText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f.]/g, "").toLowerCase()
    .replace(/\b(?:de|of)\b/g, " ").replace(/\s+/g, " ").trim();
}

export function expectedCalendarDateText(date: string) {
  return normalizeCalendarDateText(new Date(`${date}T00:00:00Z`).toLocaleDateString("es-CO", {
    day: "numeric", month: "short", timeZone: "UTC",
  }));
}

export function calendarDateTextMatches(value: string, date: string) {
  const normalizedValue = normalizeCalendarDateText(value);
  return normalizedValue.includes(date) || normalizedValue.includes(expectedCalendarDateText(date));
}
