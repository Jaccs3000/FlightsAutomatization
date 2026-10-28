import { describe, expect, it } from "vitest";
import { buildPriceAlertMessage } from "./email";
import type { FlightPriceResult, FollowUp } from "./types";

const followUp: FollowUp = {
  id: "qa", name: "Vacaciones <junio>", originIata: "BOG", destinationIata: "CLO",
  tripType: "round_trip", outboundMode: "exact", outboundStart: "2026-11-15", outboundEnd: null,
  inboundMode: "exact", inboundStart: "2026-11-18", inboundEnd: null,
  stayNights: 3, adults: 2, maxPriceCop: 500000, status: "active",
  createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z",
};

const result: FlightPriceResult = {
  outboundDate: "2026-11-15", inboundDate: "2026-11-18", amount: 245000, currency: "COP",
  comparable: true, meetsThreshold: true, observedText: "$245 k", details: "Precio para 3 noches",
};

describe("Gmail flight alert message", () => {
  it("includes matching results, threshold, observation time, and escapes HTML", () => {
    const message = buildPriceAlertMessage({
      followUp,
      results: [result, { ...result, outboundDate: "2026-11-16", inboundDate: "2026-11-19", amount: 230000, observedText: "$230 k" }],
      runTime: "26 oct 2026, 8:00 a. m.",
    });

    expect(message.subject).toBe("Vuelo BOG → CLO - 15 Nov - $ 245.000 - 2 adultos");
    expect(message.html).toContain("&lt;junio&gt;");
    expect(message.html).toContain("2026-11-15 → 2026-11-18");
    expect(message.html).toContain("2026-11-16 → 2026-11-19");
    expect(message.html).toContain("245.000 COP");
    expect(message.html).toContain("230.000 COP");
    expect(message.html).toContain("500.000 COP");
    expect(message.html).toContain("26 oct 2026, 8:00 a. m.");
    expect(message.html).toContain("$245 k · Precio para 3 noches");
  });

  it("formats the subject with the first matching date, COP price, and singular adult", () => {
    const message = buildPriceAlertMessage({
      followUp: { ...followUp, originIata: "CTG", destinationIata: "CLO", adults: 1 },
      results: [{ ...result, outboundDate: "2027-03-25", inboundDate: null, amount: 180000 }],
      runTime: "",
    });

    expect(message.subject).toBe("Vuelo CTG → CLO - 25 Mar - $ 180.000 - 1 adulto");
  });
});
