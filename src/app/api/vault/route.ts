import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireLocalOrigin } from "@/lib/http";
import { isVaultUnlocked, lockVault, resetVault, setupVault, unlockVault, vaultStatus } from "@/lib/vault";
import { errorSummary, logDiagnostic } from "@/lib/diagnostics";

export async function GET() { return NextResponse.json({ ...await vaultStatus() }); }

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (body.action === "lock") { lockVault(); await logDiagnostic("Bóveda", "Bloquear", "success", "La bóveda fue bloqueada."); }
    else if (body.action === "setup") { await setupVault(String(body.passphrase ?? "")); await logDiagnostic("Bóveda", "Crear clave maestra", "success", "La bóveda fue creada y desbloqueada."); }
    else if (body.action === "reset") {
      if (body.confirmation !== "RESTABLECER BÓVEDA") return NextResponse.json({ error: "Confirma el restablecimiento de la bóveda." }, { status: 400 });
      await resetVault();
      await logDiagnostic("Bóveda", "Restablecer", "warning", "Se borraron la clave maestra y los secretos cifrados; las demás configuraciones se conservaron.");
    }
    else if (body.action === "unlock") {
      const passphrase = String(body.passphrase ?? "");
      const ok = await unlockVault(passphrase);
      if (!ok) { await logDiagnostic("Bóveda", "Desbloquear", "error", `La clave maestra fue rechazada; se recibieron ${passphrase.length} caracteres y no se registró el contenido.`); return NextResponse.json({ error: "La clave maestra no coincide." }, { status: 401 }); }
      await logDiagnostic("Bóveda", "Desbloquear", "success", "La bóveda fue desbloqueada.");
    } else return NextResponse.json({ error: "Acción no válida." }, { status: 400 });
    return NextResponse.json({ ...await vaultStatus(), unlocked: isVaultUnlocked() });
  } catch (error) { await logDiagnostic("Bóveda", "Operación", "error", errorSummary(error)); return errorResponse(error); }
}
