import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireLocalOrigin } from "@/lib/http";
import { emailJsConfigured, getEmailJsConfigForUi, saveEmailJsConfig } from "@/lib/emailjs";
import { isVaultUnlocked, vaultStatus } from "@/lib/vault";
import { errorSummary, logDiagnostic } from "@/lib/diagnostics";

export async function GET() {
  const [emailjs, vault] = await Promise.all([getEmailJsConfigForUi(), vaultStatus()]);
  return NextResponse.json({ ...emailjs, vault });
}

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    if (!isVaultUnlocked()) {
      await logDiagnostic("EmailJS", "Guardar configuración", "error", "No se guardó: la bóveda está bloqueada.");
      return NextResponse.json({ error: "Desbloquea la bóveda antes de guardar la configuración de EmailJS." }, { status: 400 });
    }
    await saveEmailJsConfig({
      serviceId: typeof body.serviceId === "string" ? body.serviceId : "",
      templateId: typeof body.templateId === "string" ? body.templateId : "",
      publicKey: typeof body.publicKey === "string" ? body.publicKey : "",
      privateKey: typeof body.privateKey === "string" ? body.privateKey : "",
    });
    await logDiagnostic("EmailJS", "Guardar configuración", "success", "Configuración guardada en la bóveda local cifrada.");
    return NextResponse.json(await getEmailJsConfigForUi());
  } catch (error) {
    await logDiagnostic("EmailJS", "Guardar configuración", "error", errorSummary(error));
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireLocalOrigin(request);
  if (denied) return denied;
  try {
    if (!isVaultUnlocked()) return NextResponse.json({ error: "Desbloquea la bóveda para desconectar EmailJS." }, { status: 400 });
    const { deleteVaultSecret } = await import("@/lib/vault");
    const { updateSenderEmail } = await import("@/lib/db");
    await deleteVaultSecret("emailjs_config");
    await updateSenderEmail(null);
    await logDiagnostic("EmailJS", "Desconectar", "success", "La configuración de EmailJS fue eliminada de la bóveda.");
    return NextResponse.json({ ...(await getEmailJsConfigForUi()), configured: await emailJsConfigured() });
  } catch (error) {
    await logDiagnostic("EmailJS", "Desconectar", "error", errorSummary(error));
    return errorResponse(error);
  }
}
