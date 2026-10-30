import { describe, expect, it } from "vitest";
import { calendarDateTextMatches, expectedCalendarDateText } from "./google-flights-date-match";

describe("Google Flights calendar date confirmation", () => {
  it("normalizes the Spanish locale date to match Google's compact calendar label", () => {
    expect(expectedCalendarDateText("2026-10-30")).toBe("30 oct");
    expect(calendarDateTextMatches("vie, 30 oct", "2026-10-30")).toBe(true);
  });

  it("matches full labels and ISO dates but rejects another date", () => {
    expect(calendarDateTextMatches("viernes, 30 de octubre de 2026", "2026-10-30")).toBe(true);
    expect(calendarDateTextMatches("2026-10-30", "2026-10-30")).toBe(true);
    expect(calendarDateTextMatches("sáb, 31 oct", "2026-10-30")).toBe(false);
  });
});
