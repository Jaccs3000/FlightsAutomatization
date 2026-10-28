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

  it("groups same-price airline options while preserving real outbound-return pairs", () => {
    const option = {
      outboundAirline: "Avianca", outboundLogoUrl: "https://www.gstatic.com/flights/airline_logos/70px/AV.png", inboundAirline: "Avianca", inboundLogoUrl: "https://www.gstatic.com/flights/airline_logos/70px/AV.png", outboundDepartureTime: "9:20 a. m.",
      outboundArrivalTime: "10:30 a. m.", inboundDepartureTime: "1:20 p. m.", inboundArrivalTime: "5:45 p. m.",
      amount: 350000, currency: "COP", outboundStops: "Directo", inboundStops: "Directo", separateTickets: false,
    };
    const message = buildPriceAlertMessage({
      followUp,
      results: [{ ...result, flightOptions: [option, { ...option, outboundDepartureTime: "4:00 p. m.", outboundArrivalTime: "5:10 p. m." }], flightDetailsStatus: "available" }],
      runTime: "",
    });
    expect(message.html.match(/<strong>Precio:<\/strong>/g)).toHaveLength(1);
    expect(message.html).toContain("Aerolínea:</strong> <img");
    expect(message.html).toContain("</strong> · 2026-11-15");
    expect(message.html).toContain("width=\"26\" height=\"26\"");
    expect(message.html).toContain("airline_logos/70px/AV.png");
    expect(message.html).toContain("9:20 a. m. - 10:30 a. m.");
    expect(message.html).toContain("4:00 p. m. - 5:10 p. m.");
    expect(message.html).toContain("1:20 p. m. - 5:45 p. m.");
  });

  it("shows each carrier when a real pairing uses different airlines and keeps calendar fallback", () => {
    const option = {
      outboundAirline: "Avianca", inboundAirline: "LATAM", outboundDepartureTime: "9:20 a. m.",
      outboundArrivalTime: "10:30 a. m.", inboundDepartureTime: "1:20 p. m.", inboundArrivalTime: "5:45 p. m.",
      amount: 350000, currency: "COP", outboundStops: null, inboundStops: null, separateTickets: true,
    };
    const message = buildPriceAlertMessage({
      followUp, results: [
        { ...result, flightOptions: [option], flightDetailsStatus: "available" },
        { ...result, outboundDate: "2026-11-16", flightOptions: [], flightDetailsStatus: "unavailable" },
      ], runTime: "",
    });
    expect(message.html).toContain("Avianca (ida) / LATAM (regreso)");
    expect(message.html).toContain("Incluye boletos separados.");
    expect(message.html).toContain("no fue posible cargar el detalle de horarios");
  });
});
