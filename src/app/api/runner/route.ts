import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireLocalOrigin } from "@/lib/http";
import { runnerState, runAllNow, runFollowUpNow } from "@/lib/runner";
import { errorSummary, logDiagnostic } from "@/lib/diagnostics";

export async function GET() { return NextResponse.json(runnerState()); }

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request); if (denied) return denied;
  if (runnerState().running) return NextResponse.json({ error: "Ya hay una ejecución activa." }, { status: 409 });
  try {
    const body = await request.json().catch(() => ({}));
    void (body.followUpId ? runFollowUpNow(String(body.followUpId)) : runAllNow());
    await logDiagnostic("Ejecución", "Manual", "info", body.followUpId ? "Se inició una consulta manual de un seguimiento." : "Se inició una consulta manual de seguimientos activos.");
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) { await logDiagnostic("Ejecución", "Manual", "error", errorSummary(error)); return errorResponse(error); }
}
