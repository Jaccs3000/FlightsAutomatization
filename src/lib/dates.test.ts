import { describe, expect, it } from "vitest";
import { colombianNationalHolidays, dateRange, daysBetween, isColombianMondayHoliday, validRoundTripPairs, weekendEscapeCandidates, weekendEscapePairs } from "./dates";
import { followUpSchema } from "./validation";

describe("flight follow-up dates", () => {
  it("includes both ends of a flexible range", () => {
    expect(dateRange("flexible", "2027-01-01", "2027-01-03")).toEqual(["2027-01-01", "2027-01-02", "2027-01-03"]);
  });

  it("creates only valid one-night-or-longer return pairs", () => {
    const pairs = validRoundTripPairs({
      name: "Weekend", originIata: "BOG", destinationIata: "CLO", tripType: "round_trip",
      outboundMode: "flexible", outboundStart: "2027-01-01", outboundEnd: "2027-01-02",
      inboundMode: "flexible", inboundStart: "2027-01-01", inboundEnd: "2027-01-04",
      stayNights: 2, adults: 1, maxPriceCop: 400000, status: "active",
    });
    expect(pairs).toEqual([
      { outboundDate: "2027-01-01", inboundDate: "2027-01-03" },
      { outboundDate: "2027-01-02", inboundDate: "2027-01-04" },
    ]);
  });

  it("rejects more than 50 valid combinations", () => {
    const parsed = followUpSchema.safeParse({
      name: "Many dates", originIata: "BOG", destinationIata: "CLO", tripType: "round_trip",
      outboundMode: "flexible", outboundStart: "2027-01-01", outboundEnd: "2027-01-31",
      inboundMode: "flexible", inboundStart: "2027-02-01", inboundEnd: "2027-03-03",
      stayNights: null, adults: 1, maxPriceCop: 400000, status: "active",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((issue) => issue.message.includes("50 combinaciones"))).toBe(true);
  });

  it("calculates nights without local-time daylight changes", () => {
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
  });

  it("uses Colombian Monday holidays, including the 2026 Chiquinquirá holiday", () => {
    const holidays2026 = colombianNationalHolidays(2026);
    expect(holidays2026).toContain("2026-07-13");
    expect(holidays2026).toContain("2026-11-02");
    expect(holidays2026).toContain("2026-11-16");
    expect(colombianNationalHolidays(2027)).toContain("2027-01-11");
    expect(isColombianMondayHoliday("2026-11-02")).toBe(true);
    expect(isColombianMondayHoliday("2026-11-01")).toBe(false);
  });

  it("generates both Sunday and Monday return pairs when Monday is a Colombian holiday", () => {
    const pairs = weekendEscapePairs("2026-10-30", 4);
    expect(pairs).toContainEqual({ outboundDate: "2026-10-30", inboundDate: "2026-11-01", outboundWindow: "friday_evening", inboundWindow: "sunday_evening" });
    expect(pairs).toContainEqual({ outboundDate: "2026-10-30", inboundDate: "2026-11-02", outboundWindow: "friday_evening", inboundWindow: "monday_holiday_evening" });
    expect(pairs).toContainEqual({ outboundDate: "2026-10-31", inboundDate: "2026-11-02", outboundWindow: "saturday_morning", inboundWindow: "monday_holiday_evening" });
  });

  it("allows one or more distinct weekend escape destinations and validates configurable horizons", () => {
    const base = {
      name: "Fuga", originIata: "BOG", destinationIata: "CLO", destinationIatas: ["CLO", "CTG", "MDE"],
      mode: "weekend_escape", lookaheadDays: 120, minNoticeHours: 8,
      tripType: "round_trip", outboundMode: "exact", outboundStart: "2027-01-01", outboundEnd: null,
      inboundMode: "exact", inboundStart: "2027-01-02", inboundEnd: null, stayNights: null,
      adults: 1, maxPriceCop: 400000, status: "active",
    };
    expect(followUpSchema.safeParse(base).success).toBe(true);
    expect(followUpSchema.safeParse({ ...base, destinationIatas: ["CLO"] }).success).toBe(true);
    expect(followUpSchema.safeParse({ ...base, destinationIatas: ["CLO", "CLO"] }).success).toBe(false);
    expect(followUpSchema.safeParse({ ...base, lookaheadDays: 366 }).success).toBe(false);
  });

  it("applies the combination cap across all destinations and preserves each route", () => {
    const candidates = weekendEscapeCandidates(["CLO", "CTG", "MDE", "BAQ"], "2026-10-28", 365, 200);
    expect(candidates).toHaveLength(200);
    expect(new Set(candidates.map((candidate) => candidate.destinationIata))).toEqual(new Set(["CLO", "CTG", "MDE", "BAQ"]));
    expect(candidates.every((candidate) => candidate.outboundDate < candidate.inboundDate)).toBe(true);
  });
});
