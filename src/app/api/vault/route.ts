import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireLocalOrigin } from "@/lib/http";
import { isVaultUnlocked, lockVault, rememberVaultPassphrase, resetVault, setupVault, unlockVault, vaultStatus } from "@/lib/vault";
import { errorSummary, logDiagnostic } from "@/lib/diagnostics";

export async function GET() { return NextResponse.json({ ...await vaultStatus() }); }

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (body.action === "lock") {
      lockVault();
      await logDiagnostic("Vault", "Lock", "success", "Vault locked.");
    } else if (body.action === "setup") {
      const passphrase = String(body.passphrase ?? "");
      await setupVault(passphrase);
      await rememberVaultPassphrase(body.remember === true ? passphrase : null);
      await logDiagnostic("Vault", "Create master key", "success", "Vault created and unlocked.");
    } else if (body.action === "reset") {
      if (body.confirmation !== "RESET_VAULT") return NextResponse.json({ error: "Confirm the vault reset." }, { status: 400 });
      await resetVault();
      await rememberVaultPassphrase(null);
      await logDiagnostic("Vault", "Reset", "warning", "Vault key and encrypted secrets were removed; other settings were kept.");
    } else if (body.action === "unlock") {
      const passphrase = String(body.passphrase ?? "");
      const ok = await unlockVault(passphrase);
      if (!ok) {
        await logDiagnostic("Vault", "Unlock", "error", `Master key rejected; ${passphrase.length} characters received. Key content was not logged.`);
        return NextResponse.json({ error: "La clave maestra no coincide." }, { status: 401 });
      }
      await rememberVaultPassphrase(body.remember === true ? passphrase : null);
      await logDiagnostic("Vault", "Unlock", "success", "Vault unlocked.");
    } else if (body.action === "remember") {
      if (body.remember === false) await rememberVaultPassphrase(null);
      else {
        const passphrase = String(body.passphrase ?? "");
        if (!await unlockVault(passphrase)) return NextResponse.json({ error: "La clave maestra no coincide." }, { status: 401 });
        await rememberVaultPassphrase(passphrase);
      }
      await logDiagnostic("Vault", "Remember key", "success", body.remember === false ? "Remembered key removed from local file." : "Remembered key saved to local file.");
    } else return NextResponse.json({ error: "Accion no valida." }, { status: 400 });
    return NextResponse.json({ ...await vaultStatus(), unlocked: isVaultUnlocked() });
  } catch (error) {
    await logDiagnostic("Vault", "Operation", "error", errorSummary(error));
    return errorResponse(error);
  }
}
