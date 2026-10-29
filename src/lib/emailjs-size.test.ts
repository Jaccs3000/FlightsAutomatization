import { describe, expect, it } from "vitest";
import { assertEmailJsPayloadWithinLimit, emailJsPayloadBytes, EMAILJS_SAFE_PAYLOAD_BYTES } from "./emailjs-size";

describe("EmailJS payload size preflight", () => {
  it("measures the serialized UTF-8 request payload", () => {
    const payload = { template_params: { subject: "Vuelo CTG → BOG", html_body: "<p>á</p>" } };
    expect(emailJsPayloadBytes(payload)).toBe(new TextEncoder().encode(JSON.stringify(payload)).byteLength);
    expect(assertEmailJsPayloadWithinLimit(payload)).toBe(emailJsPayloadBytes(payload));
  });

  it("predicts the provider size error before making a request", () => {
    const payload = { template_params: { html_body: "x".repeat(EMAILJS_SAFE_PAYLOAD_BYTES) } };
    expect(() => assertEmailJsPayloadWithinLimit(payload)).toThrow(/Correo no enviado.*límite preventivo.*EmailJS permite hasta 50 KB/);
  });
});
