import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireLocalOrigin } from "@/lib/http";
import { runnerState, runAllNow, runFollowUpNow, stopRun } from "@/lib/runner";
import { errorSummary, logDiagnostic } from "@/lib/diagnostics";

export async function GET() { return NextResponse.json(runnerState()); }

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request); if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "stop") {
      const runId = typeof body.runId === "string" ? body.runId : "";
      if (!runId) return NextResponse.json({ error: "Falta el identificador de la ejecución." }, { status: 400 });
      const stopped = await stopRun(runId);
      return stopped ? NextResponse.json({ stopped: true }) : NextResponse.json({ error: "La ejecución ya no está en curso." }, { status: 409 });
    }
    if (runnerState().running) return NextResponse.json({ error: "Ya hay una ejecución activa." }, { status: 409 });
    void (body.followUpId ? runFollowUpNow(String(body.followUpId)) : runAllNow());
    await logDiagnostic("Ejecución", "Manual", "info", body.followUpId ? "Se inició una consulta manual de un seguimiento." : "Se inició una consulta manual de seguimientos activos.");
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) { await logDiagnostic("Ejecución", "Manual", "error", errorSummary(error)); return errorResponse(error); }
}
