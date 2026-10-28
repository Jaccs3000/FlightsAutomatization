import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { errorResponse, requireLocalOrigin } from "@/lib/http";
import { emailJsConfigured, sendEmailJsTest } from "@/lib/emailjs";
import { isVaultUnlocked } from "@/lib/vault";
import { errorSummary, logDiagnostic } from "@/lib/diagnostics";

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request);
  if (denied) return denied;
  try {
    if (!isVaultUnlocked()) {
      await logDiagnostic("EmailJS", "Correo de prueba", "error", "No enviado: la bóveda está bloqueada.");
      return NextResponse.json({ error: "Desbloquea la bóveda antes de enviar la prueba." }, { status: 400 });
    }
    if (!await emailJsConfigured()) {
      await logDiagnostic("EmailJS", "Correo de prueba", "error", "No enviado: EmailJS no está configurado.");
      return NextResponse.json({ error: "Configura EmailJS en Ajustes antes de enviar la prueba." }, { status: 400 });
    }
    const settings = await getSettings();
    await logDiagnostic("EmailJS", "Correo de prueba", "info", "Intento de envío HTTPS iniciado.");
    await sendEmailJsTest(settings.recipientEmail);
    await logDiagnostic("EmailJS", "Correo de prueba", "success", "EmailJS aceptó el correo de prueba.");
    return NextResponse.json({ sent: true, recipient: settings.recipientEmail });
  } catch (error) {
    await logDiagnostic("EmailJS", "Correo de prueba", "error", errorSummary(error));
    return errorResponse(error);
  }
}
