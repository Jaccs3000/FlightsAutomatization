import { appendDiagnosticLog } from "./db";

type Outcome = "info" | "success" | "warning" | "error";

export function sanitizeDiagnosticMessage(value: unknown) {
  let message = value instanceof Error ? value.message : String(value ?? "Error desconocido");
  message = message
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [oculto]")
    .replace(/(password|passwd|secret|token|client_secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[oculto]")
    .replace(/\b(?:[a-z0-9]{4}\s+){3}[a-z0-9]{4}\b/gi, "[clave de aplicación oculta]")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "[correo]")
    .replace(/\b(?=[a-z0-9+/_=-]{16,}\b)(?=[a-z0-9+/_=-]*\d)[a-z0-9+/_=-]{16,}\b/gi, "[credencial oculta]");
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

export async function logDiagnostic(area: string, event: string, outcome: Outcome, message: string) {
  try {
    await appendDiagnosticLog({ area, event, outcome, message: sanitizeDiagnosticMessage(message) });
  } catch {
    // Diagnostic logging must never break the operation it is observing.
  }
}

export function errorSummary(error: unknown) {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
    return sanitizeDiagnosticMessage(`${error.name}${code}: ${error.message}`);
  }
  return sanitizeDiagnosticMessage(error);
}
