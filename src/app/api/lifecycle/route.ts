import { NextRequest, NextResponse } from "next/server";
import { startRestartSupervisor } from "@/lib/lifecycle-control";
import { requireLocalOrigin } from "@/lib/http";
import { runnerState } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ready: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const denied = requireLocalOrigin(request);
  if (denied) return denied;
  if (runnerState().running) {
    return NextResponse.json({ error: "Espera a que termine la consulta de vuelos antes de cerrar o reiniciar." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action !== "stop" && body.action !== "restart") {
    return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
  }
  if (body.action === "restart") {
    try { await startRestartSupervisor(); }
    catch { return NextResponse.json({ error: "No se pudo preparar el reinicio de la aplicación." }, { status: 500 }); }
  }

  const response = NextResponse.json({ accepted: true, action: body.action }, { status: 202, headers: { "Cache-Control": "no-store" } });
  // Let Next flush the response before exiting the process. Restart mode has
  // already launched a detached supervisor that waits for the port and DuckDB.
  const exitTimer = setTimeout(() => process.exit(0), 300);
  exitTimer.unref();
  return response;
}
