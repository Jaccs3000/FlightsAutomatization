import airports from "../airport-catalog/airports.json";

export interface AirportRecord {
  code: string;
  name: string;
  city: string;
  country: string;
  countryName: string;
  scheduled: boolean;
  type: string;
}

const countryNames = new Intl.DisplayNames(["es"], { type: "region" });
const catalog = (airports as Omit<AirportRecord, "countryName">[]).map((airport) => ({
  ...airport,
  countryName: countryNames.of(airport.country) ?? airport.country,
}));
const typeRank: Record<string, number> = { large_airport: 0, medium_airport: 1, small_airport: 2, seaplane_base: 3, heliport: 4 };

export function normalizeAirportSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

export function findAirports(query: string, limit = 10): AirportRecord[] {
  const needle = normalizeAirportSearch(query);
  if (!needle || limit < 1) return [];

  return catalog
    .map((airport) => {
      const code = normalizeAirportSearch(airport.code);
      const name = normalizeAirportSearch(airport.name);
      const city = normalizeAirportSearch(airport.city);
      const country = normalizeAirportSearch(`${airport.country} ${airport.countryName}`);
      const all = `${code} ${name} ${city} ${country}`;
      const rank = code === needle ? 0
        : code.startsWith(needle) ? 1
          : city.startsWith(needle) ? 2
            : name.startsWith(needle) ? 3
              : all.includes(needle) ? 4
                : Number.POSITIVE_INFINITY;
      return { airport, rank };
    })
    .filter((item) => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank
      || Number(b.airport.scheduled) - Number(a.airport.scheduled)
      || (typeRank[a.airport.type] ?? 9) - (typeRank[b.airport.type] ?? 9)
      || a.airport.name.localeCompare(b.airport.name))
    .slice(0, Math.min(limit, 20))
    .map(({ airport }) => airport);
}
