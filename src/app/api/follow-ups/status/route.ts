import { NextRequest, NextResponse } from "next/server";
import { setFollowUpStatus } from "@/lib/db";
import { errorResponse, requireLocalOrigin } from "@/lib/http";
import { errorSummary, logDiagnostic } from "@/lib/diagnostics";

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (typeof body.id !== "string" || !["active", "paused"].includes(body.status)) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
    const updated = await setFollowUpStatus(body.id, body.status);
    await logDiagnostic("Seguimientos", body.status === "active" ? "Activar" : "Pausar", updated ? "success" : "warning", updated ? `Seguimiento ${body.status === "active" ? "activado" : "pausado"}.` : "No se encontró el seguimiento.");
    return NextResponse.json({ updated });
  } catch (error) { await logDiagnostic("Seguimientos", "Cambiar estado", "error", errorSummary(error)); return errorResponse(error); }
}
