import { describe, expect, it } from "vitest";
import { hasMinimumNotice, isTimeInWindow, passesEscapeSchedule, timeTextToMinutes, type EscapeCriteria } from "./google-flights";
import type { FlightItineraryOption } from "./types";

describe("weekend escape flight time checks", () => {
  it("parses Google Flights Spanish AM/PM times and includes window boundaries", () => {
    expect(timeTextToMinutes("7:00 p. m.")).toBe(19 * 60);
    expect(timeTextToMinutes("12:00 a. m.")).toBe(0);
    expect(timeTextToMinutes("12:00 p. m.")).toBe(12 * 60);
    expect(isTimeInWindow("7:00 p. m.", 19 * 60, 22 * 60)).toBe(true);
    expect(isTimeInWindow("10:00 p. m.", 19 * 60, 22 * 60)).toBe(true);
    expect(isTimeInWindow("10:01 p. m.", 19 * 60, 22 * 60)).toBe(false);
  });

  it("uses local airport time for the minimum lead-time threshold", () => {
    const now = Date.parse("2026-10-30T11:00:00-05:00");
    expect(hasMinimumNotice("2026-10-30", "7:00 p. m.", "America/Bogota", 8, now)).toBe(true);
    expect(hasMinimumNotice("2026-10-30", "6:59 p. m.", "America/Bogota", 8, now)).toBe(false);
  });

  it("accepts only complete real pairs inside both schedule windows and the lead-time limit", () => {
    const criteria: EscapeCriteria = {
      outboundDate: "2026-10-30", inboundDate: "2026-11-01", outboundWindow: "friday_evening",
      inboundWindow: "sunday_evening", originTimeZone: "America/Bogota", minimumNoticeHours: 8,
    };
    const option: FlightItineraryOption = {
      outboundAirline: "Avianca", inboundAirline: "Avianca", outboundDepartureTime: "7:00 p. m.",
      outboundArrivalTime: "8:15 p. m.", inboundDepartureTime: "4:00 p. m.", inboundArrivalTime: "5:15 p. m.",
      amount: 300000, currency: "COP", outboundStops: null, inboundStops: null, separateTickets: false,
    };
    const exactlyEightHoursBeforeDeparture = Date.parse("2026-10-30T11:00:00-05:00");
    expect(passesEscapeSchedule(option, criteria, exactlyEightHoursBeforeDeparture)).toBe(true);
    expect(passesEscapeSchedule(option, criteria, exactlyEightHoursBeforeDeparture + 1_000)).toBe(false);
    expect(passesEscapeSchedule({ ...option, outboundDepartureTime: "10:01 p. m." }, criteria, exactlyEightHoursBeforeDeparture)).toBe(false);
    expect(passesEscapeSchedule({ ...option, inboundDepartureTime: "8:01 p. m." }, criteria, exactlyEightHoursBeforeDeparture)).toBe(false);
    expect(passesEscapeSchedule({ ...option, inboundDepartureTime: null }, criteria, exactlyEightHoursBeforeDeparture)).toBe(false);
  });
});
