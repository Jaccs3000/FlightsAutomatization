export const EMAILJS_VARIABLE_LIMIT_BYTES = 50_000;
// Keep headroom for EmailJS serialization differences and count the whole
// request body, not just the HTML string.
export const EMAILJS_SAFE_PAYLOAD_BYTES = 48_000;

export function emailJsPayloadBytes(payload: unknown) {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

export function assertEmailJsPayloadWithinLimit(payload: unknown) {
  const bytes = emailJsPayloadBytes(payload);
  if (bytes > EMAILJS_SAFE_PAYLOAD_BYTES) {
    const actualKb = (bytes / 1_000).toFixed(1);
    const safeLimitKb = (EMAILJS_SAFE_PAYLOAD_BYTES / 1_000).toFixed(0);
    const providerLimitKb = (EMAILJS_VARIABLE_LIMIT_BYTES / 1_000).toFixed(0);
    throw new Error(`Correo no enviado: el contenido ocupa ${actualKb} KB y supera el límite preventivo de ${safeLimitKb} KB. EmailJS permite hasta ${providerLimitKb} KB en variables; reduce la cantidad de opciones del correo.`);
  }
  return bytes;
}
