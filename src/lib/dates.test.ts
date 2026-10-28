import { describe, expect, it } from "vitest";
import { dateRange, daysBetween, validRoundTripPairs } from "./dates";
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
});
