import { describe, expect, it } from "vitest";
import { parseGoogleFlightCard } from "./google-flights-parser";

describe("Google Flights result card parser", () => {
  it("extracts an airline, times, total COP price, and stops from the accessible card label", () => {
    const parsed = parseGoogleFlightCard(
      "Precio total ida y vuelta desde 350000 pesos colombianos. Vuelo sin escalas de Avianca. Sale de CTG a las 9:20 a.m. y llega a BOG a las 10:30 a.m. Seleccionar vuelo",
      "9:20 a.m. – 10:30 a.m.\nAvianca\nDirecto\n350.000 COP ida y vuelta",
      "https://www.gstatic.com/flights/airline_logos/70px/AV.png",
    );
    expect(parsed).toMatchObject({ airline: "Avianca", logoUrl: "https://www.gstatic.com/flights/airline_logos/70px/AV.png", departureTime: "9:20 a. m.", arrivalTime: "10:30 a. m.", amount: 350000, currency: "COP", stops: "Directo" });
  });

  it("identifies split-ticket options", () => {
    const parsed = parseGoogleFlightCard(
      "Vuelo sin escalas de LATAM. Sale de BOG a las 1:20 p.m. y llega a CTG a las 5:45 p.m. Seleccionar vuelo",
      "Boletos separados · LATAM\n1:20 p.m. – 5:45 p.m.\n350.000 COP",
    );
    expect(parsed?.separateTickets).toBe(true);
    expect(parsed?.airline).toBe("LATAM");
  });

  it("uses the carrier logo label when Google changes the result wording", () => {
    const parsed = parseGoogleFlightCard(
      "Precio total ida y vuelta desde 376010 pesos colombianos. Vuelo de CTG a BOG. Sale de CTG a las 9:45 p.m. y llega a BOG a las 11:15 p.m.",
      "9:45 p.m. – 11:15 p.m.\nDirecto\n376.010 COP ida y vuelta",
      "https://www.gstatic.com/flights/airline_logos/70px/AV.png",
      "Avianca",
    );
    expect(parsed).toMatchObject({ airline: "Avianca", logoUrl: "https://www.gstatic.com/flights/airline_logos/70px/AV.png" });
  });
});
