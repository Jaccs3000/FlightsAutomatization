import { describe, expect, it } from "vitest";
import { findAirports, normalizeAirportSearch } from "./airport-search";

describe("global airport autocomplete catalog", () => {
  it("finds airports by IATA code and gives exact codes first", () => {
    expect(findAirports("LHR")[0]).toMatchObject({ code: "LHR", city: "London", scheduled: true });
    expect(findAirports("JFK")[0].name).toContain("Kennedy");
  });

  it("finds city and airport names without requiring accents", () => {
    expect(normalizeAirportSearch("Bogotá")).toBe("bogota");
    expect(findAirports("Bogotá").some((airport) => airport.code === "BOG")).toBe(true);
    expect(findAirports("El Dorado International")[0].code).toBe("BOG");
  });

  it("searches country names and returns location details for worldwide airports", () => {
    expect(findAirports("Colombia").some((airport) => airport.code === "BOG")).toBe(true);
    expect(findAirports("NRT")[0]).toMatchObject({ city: "Narita", countryName: "Japón" });
    expect(findAirports("SYD")[0].city).toContain("Sydney");
    expect(findAirports("SYD")[0].countryName).toBe("Australia");
  });

  it("limits suggestions and returns no matches for blank searches", () => {
    expect(findAirports("a", 5)).toHaveLength(5);
    expect(findAirports("   ")).toEqual([]);
  });
});
