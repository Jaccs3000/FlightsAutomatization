import { describe, expect, it } from "vitest";
import { meetsCopThreshold, parsePrice } from "./prices";

describe("Google Flights calendar price parsing", () => {
  it("converts abbreviated COP calendar amounts", () => {
    expect(parsePrice("15 $245 k")).toEqual({ amount: 245000, currency: "COP" });
    expect(parsePrice("$ 350 mil")).toEqual({ amount: 350000, currency: "COP" });
    expect(parsePrice("350 mil COP")).toEqual({ amount: 350000, currency: "COP" });
  });

  it("keeps a dollar currency code when Google shows one", () => {
    expect(parsePrice("US$ 1,250")).toEqual({ amount: 1250, currency: "USD" });
    expect(parsePrice("CA$ 880")).toEqual({ amount: 880, currency: "CAD" });
  });

  it("recognizes EUR and GBP symbols without conversion", () => {
    expect(parsePrice("€320")).toEqual({ amount: 320, currency: "EUR" });
    expect(parsePrice("£410")).toEqual({ amount: 410, currency: "GBP" });
  });

  it("ignores a day with no visible price", () => {
    expect(parsePrice("15")).toBeNull();
  });
});

describe("inclusive COP threshold", () => {
  it("accepts a price equal to the limit and rejects higher or incomparable currencies", () => {
    expect(meetsCopThreshold({ amount: 500000, currency: "COP", comparable: true }, 500000)).toBe(true);
    expect(meetsCopThreshold({ amount: 500001, currency: "COP", comparable: true }, 500000)).toBe(false);
    expect(meetsCopThreshold({ amount: 500000, currency: "USD", comparable: false }, 500000)).toBe(false);
    expect(meetsCopThreshold({ amount: null, currency: "COP", comparable: true }, 500000)).toBe(false);
  });
});
