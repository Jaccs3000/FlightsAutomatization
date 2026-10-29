import { NextRequest, NextResponse } from "next/server";
import { clearHistory, listRuns } from "@/lib/db";
import { errorResponse, requireLocalOrigin } from "@/lib/http";
import { runnerState } from "@/lib/runner";

export async function GET() { return NextResponse.json({ runs: await listRuns(150) }); }

export async function DELETE(request: NextRequest) {
  const denied = requireLocalOrigin(request);
  if (denied) return denied;
  if (runnerState().running) return NextResponse.json({ error: "Espera a que termine la consulta antes de borrar el historial." }, { status: 409 });
  try {
    const deletedRuns = await clearHistory();
    return NextResponse.json({ deletedRuns });
  } catch (error) {
    return errorResponse(error, 500);
  }
}
