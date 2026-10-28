import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { errorResponse, requireLocalOrigin } from "@/lib/http";
import { settingsSchema } from "@/lib/validation";
import { vaultStatus } from "@/lib/vault";
import { errorSummary, logDiagnostic } from "@/lib/diagnostics";

export async function GET() {
  const [settings, vault] = await Promise.all([getSettings(), vaultStatus()]);
  return NextResponse.json({ settings, vault, unlocked: vault.unlocked });
}

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) { const message = parsed.error.issues[0]?.message ?? "Revisa la configuracion."; await logDiagnostic("Configuración", "Validación", "warning", message); return NextResponse.json({ error: message }, { status: 400 }); }
    const current = await getSettings();
    await saveSettings({ ...parsed.data, senderEmail: current.senderEmail });
    await logDiagnostic("Configuración", "Guardar", "success", "Preferencias guardadas.");

    const [settings, vault] = await Promise.all([getSettings(), vaultStatus()]);
    return NextResponse.json({ settings, vault, unlocked: vault.unlocked });
  } catch (error) {
    await logDiagnostic("Configuración", "Guardar", "error", errorSummary(error));
    return errorResponse(error);
  }
}
