import { describe, expect, it } from "vitest";
import { buildPriceAlertMessage, buildPriceAlertMessages } from "./email";
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
    expect(message.html).not.toContain(">Destino</th>");
    expect(message.html).toContain("&lt;junio&gt;");
    expect(message.html).toContain("2026-11-15 → 2026-11-18");
    expect(message.html).toContain("2026-11-16 → 2026-11-19");
    expect(message.html).toContain("245.000 COP");
    expect(message.html).toContain("230.000 COP");
    expect(message.html).toContain("500.000 COP");
    expect(message.html).toContain("Fechas configuradas: ida 15 Nov 2026 · regreso 18 Nov 2026.");
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
      results: [
        { ...result, flightOptions: [{ ...option, outboundDepartureTime: "4:00 p. m.", outboundArrivalTime: "5:10 p. m." }, option], flightDetailsStatus: "available" },
        { ...result, outboundDate: "2026-11-16", inboundDate: "2026-11-19", flightOptions: [{ ...option, outboundDepartureTime: "8:00 a. m." }], flightDetailsStatus: "available" },
      ],
      runTime: "",
    });
    expect(message.html.match(/\$ 350\.000/g)).toHaveLength(1);
    expect(message.html).toContain("<img src=https://www.gstatic.com/flights/airline_logos/70px/AV.png");
    expect(message.html).toContain("airline_logos/70px/AV.png");
    expect(message.html).toContain("alt=AV>");
    expect(message.html).toContain("18 Nov 1:20 pm");
    expect(message.html).toContain("15 Nov 9:20 am");
    expect(message.html.indexOf("15 Nov 9:20 am")).toBeLessThan(message.html.indexOf("15 Nov 4:00 pm"));
    expect(message.html.indexOf("15 Nov 4:00 pm")).toBeLessThan(message.html.indexOf("16 Nov 8:00 am"));
    expect(message.html).toContain("IDA　→　REGRESO");
    expect(message.html.indexOf("IDA　→　REGRESO")).toBeLessThan(message.html.indexOf("15 Nov 9:20 am"));
    expect(message.html).toContain("15 Nov 4:00 pm");
    expect(message.html).toContain("18 Nov 1:20 pm");
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
    expect(message.html).toContain("airline_logos/70px/AV.png");
    expect(message.html).toContain("airline_logos/70px/LA.png");
    expect(message.html).toContain("Boletos separados");
    expect(message.html).toContain("no entregó el detalle de horarios");
    expect(message.html).not.toContain("45 segundos");
  });

  it("lists each weekend escape destination and its real itinerary details in one email", () => {
    const option = {
      outboundAirline: "Avianca", inboundAirline: "Avianca", outboundDepartureTime: "8:00 p. m.",
      outboundArrivalTime: "9:15 p. m.", inboundDepartureTime: "5:00 p. m.", inboundArrivalTime: "6:15 p. m.",
      amount: 300000, currency: "COP", outboundStops: "Directo", inboundStops: "Directo", separateTickets: false,
    };
    const message = buildPriceAlertMessage({
      followUp: { ...followUp, mode: "weekend_escape", destinationIatas: ["CLO", "CTG", "MDE"] },
      results: [
        { ...result, destinationIata: "CLO", amount: 300000, flightOptions: [option], flightDetailsStatus: "available" },
        { ...result, destinationIata: "CTG", outboundDate: "2026-11-21", inboundDate: "2026-11-22", amount: 320000 },
      ], runTime: "28 oct 2026, 8:00 a. m.",
    });
    expect(message.subject).toContain("Escape fin de semana BOG");
    expect(message.subject).toContain("CLO, CTG");
    expect(message.html).toContain("Escape fin de semana");
    expect(message.html).toContain("CLO · $ 300.000");
    expect(message.html).toContain(">Destino</th>");
    expect(message.html).toContain(">CTG</td>");
    expect(message.html).toContain("15 Nov 8:00 pm");
  });

  it("keeps the compact itinerary layout and splits large messages under the size limit", () => {
    const options = Array.from({ length: 200 }, (_, index) => ({
      outboundAirline: "Avianca", inboundAirline: "Avianca",
      outboundDepartureTime: "9:10 a. m.", outboundArrivalTime: "10:20 a. m.",
      inboundDepartureTime: "7:30 p. m.", inboundArrivalTime: "8:40 p. m.",
      amount: 350000 + index, currency: "COP", outboundStops: "Directo", inboundStops: "Directo", separateTickets: false,
    }));
    const messages = buildPriceAlertMessages({ recipient: "alerts@example.com", followUp, results: [{ ...result, flightOptions: options, flightDetailsStatus: "available" }], runTime: "" });
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => message.html.includes("IDA　→　REGRESO") && !message.html.includes(">Fechas</th>"))).toBe(true);
    expect(messages.reduce((count, message) => count + (message.html.match(/9:10 am/g)?.length ?? 0), 0)).toBe(200);
    expect(messages.every((message) => Buffer.byteLength(JSON.stringify({ to_email: "alerts@example.com", subject: message.subject, html_body: message.html }), "utf8") < 45_000)).toBe(true);
  });

  it("splits messages at 45 KB and labels every part while preserving all flight rows", () => {
    const options = Array.from({ length: 200 }, (_, index) => ({
      outboundAirline: "Avianca", inboundAirline: "Avianca",
      outboundDepartureTime: "9:10 a. m.", outboundArrivalTime: "10:20 a. m.",
      inboundDepartureTime: "7:30 p. m.", inboundArrivalTime: "8:40 p. m.",
      amount: 350000 + index, currency: "COP", outboundStops: "Directo", inboundStops: "Directo", separateTickets: false,
    }));
    const messages = buildPriceAlertMessages({ recipient: "alerts@example.com", followUp, results: [{ ...result, flightOptions: options, flightDetailsStatus: "available" }], runTime: "" });
    expect(messages.length).toBeGreaterThan(1);
    expect(messages[0].subject).toContain("PARTE 1/");
    expect(messages.at(-1)?.subject).toContain(`PARTE ${messages.length}/${messages.length}`);
    expect(messages.every((message) => message.html.includes(`<b>PARTE `))).toBe(true);
    expect(messages.every((message) => Buffer.byteLength(JSON.stringify({ to_email: "alerts@example.com", subject: message.subject, html_body: message.html }), "utf8") < 45_000)).toBe(true);
    expect(messages.reduce((count, message) => count + (message.html.match(/9:10 am/g)?.length ?? 0), 0)).toBe(200);
  });

  it("orders itinerary groups by price from low to high", () => {
    const cheap = { outboundAirline: "Wingo", inboundAirline: "Wingo", outboundDepartureTime: "8:00 a. m.", outboundArrivalTime: "9:00 a. m.", inboundDepartureTime: "8:00 p. m.", inboundArrivalTime: "9:00 p. m.", amount: 180000, currency: "COP", outboundStops: null, inboundStops: null, separateTickets: false };
    const expensive = { ...cheap, outboundAirline: "Avianca", inboundAirline: "Avianca", amount: 420000 };
    const message = buildPriceAlertMessage({ followUp, results: [{ ...result, flightOptions: [expensive, cheap], flightDetailsStatus: "available" }], runTime: "" });
    expect(message.html.indexOf("$ 180.000")).toBeLessThan(message.html.indexOf("$ 420.000"));
    expect(message.html).toMatch(/<\/div><br><p style="margin:8px 0 4px/);
  });

  it("shows the configured flexible outbound and return date ranges below the price limit", () => {
    const message = buildPriceAlertMessage({
      followUp: { ...followUp, outboundMode: "flexible", outboundStart: "2026-11-12", outboundEnd: "2026-11-15", inboundMode: "flexible", inboundStart: "2026-12-10", inboundEnd: "2026-12-18" },
      results: [result], runTime: "",
    });
    expect(message.html).toContain("Fechas configuradas: ida 12 Nov – 15 Nov · regreso 10 Dic – 18 Dic.");
    expect(message.html.indexOf("500.000 COP")).toBeLessThan(message.html.indexOf("Fechas configuradas:"));
  });
});
