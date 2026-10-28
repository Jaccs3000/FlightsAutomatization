import { NextRequest, NextResponse } from "next/server";
import { deleteFollowUp, listFollowUps, saveFollowUp } from "@/lib/db";
import { errorResponse, requireLocalOrigin } from "@/lib/http";
import { followUpSchema } from "@/lib/validation";
import { runAllNow, runFollowUpNow, runnerState } from "@/lib/runner";
import { errorSummary, logDiagnostic } from "@/lib/diagnostics";

export const runtime = "nodejs";

export async function GET() { return NextResponse.json({ followUps: await listFollowUps() }); }

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request); if (denied) return denied;
  try {
    const body = await request.json();
    if (body.action === "delete") {
      const deleted = await deleteFollowUp(String(body.id ?? ""));
      await logDiagnostic("Seguimientos", "Eliminar", deleted ? "success" : "warning", deleted ? "Seguimiento eliminado; su historial se conserva." : "No se encontró el seguimiento para eliminar.");
      return NextResponse.json({ deleted });
    }
    if (body.action === "run") {
      if (runnerState().running) return NextResponse.json({ error: "Ya hay una ejecución activa." }, { status: 409 });
      void (body.id ? runFollowUpNow(String(body.id)) : runAllNow());
      await logDiagnostic("Ejecución", "Manual", "info", body.id ? "Se inició una consulta manual de seguimiento." : "Se inició una consulta manual de seguimientos activos.");
      return NextResponse.json({ accepted: true }, { status: 202 });
    }
    const parsed = followUpSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revisa los datos del seguimiento." }, { status: 400 });
    const id = typeof body.id === "string" ? body.id : undefined;
    const followUp = await saveFollowUp(parsed.data, id);
    await logDiagnostic("Seguimientos", id ? "Actualizar" : "Crear", "success", `${id ? "Seguimiento actualizado" : "Seguimiento creado"}: ${followUp.originIata} → ${followUp.destinationIata}, ${followUp.tripType === "round_trip" ? "ida y vuelta" : "solo ida"}.`);
    return NextResponse.json({ followUp }, { status: id ? 200 : 201 });
  } catch (error) { await logDiagnostic("Seguimientos", "Guardar", "error", errorSummary(error)); return errorResponse(error); }
}
