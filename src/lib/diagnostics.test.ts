import { describe, expect, it } from "vitest";
import { sanitizeDiagnosticMessage } from "./diagnostics";

describe("diagnostic message redaction", () => {
  it("removes email addresses, Gmail app passwords, and bearer tokens", () => {
    const message = sanitizeDiagnosticMessage(new Error("SMTP failed for sender@gmail.com using abcd efgh ijkl mnop; Authorization: Bearer ya29.12345678901234567890"));
    expect(message).not.toContain("sender@gmail.com");
    expect(message).not.toContain("abcd efgh ijkl mnop");
    expect(message).not.toContain("ya29.12345678901234567890");
    expect(message).toContain("[correo]");
    expect(message).toContain("[clave de aplicación oculta]");
    expect(message).toContain("Bearer [oculto]");
  });

  it("flattens multiline provider errors and caps their length", () => {
    const message = sanitizeDiagnosticMessage(new Error(`SMTP\n${"x".repeat(900)}`));
    expect(message).not.toContain("\n");
    expect(message.length).toBeLessThanOrEqual(500);
  });
});
