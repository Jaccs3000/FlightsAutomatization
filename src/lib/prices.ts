export interface ParsedFlightPrice {
  amount: number;
  currency: string;
}

export function meetsCopThreshold(result: { amount: number | null; currency: string | null; comparable: boolean }, maxPriceCop: number) {
  return result.comparable && result.currency === "COP" && result.amount !== null && result.amount <= maxPriceCop;
}

export function parsePrice(text: string): ParsedFlightPrice | null {
  const normalized = text.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const match = normalized.match(/(COP|USD|US\$|EUR|€|GBP|£|CAD|CA\$|AUD|AU\$|MXN|MX\$|CLP|ARS|\$)\s*([\d.,]+)\s*(mil|[kKmM])?/i)
    ?? normalized.match(/([\d.,]+)\s*(mil|[kKmM])?\s*(COP|USD|EUR|GBP|CAD|AUD|MXN|CLP|ARS)/i);
  if (!match) return null;
  const reverse = /^\d/.test(match[1]);
  const currencyText = (reverse ? match[3] : match[1]).toUpperCase();
  const numericText = reverse ? match[1] : match[2];
  const suffix = reverse ? match[2] : match[3];
  let amount = Number(numericText.replace(/[^\d]/g, ""));
  if (suffix?.toLowerCase() === "k" || suffix?.toLowerCase() === "mil") amount *= 1000;
  if (suffix?.toLowerCase() === "m") amount *= 1_000_000;
  if (!Number.isSafeInteger(amount)) return null;
  const currencyMap: Record<string, string> = { "€": "EUR", "£": "GBP", "US$": "USD", "CA$": "CAD", "AU$": "AUD", "MX$": "MXN", "$": "COP" };
  return { amount, currency: currencyMap[currencyText] ?? currencyText };
}
