import { NextResponse } from "next/server";
import { listDiagnosticLogs } from "@/lib/db";

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? 200);
  const limit = Number.isFinite(requested) ? Math.min(5000, Math.max(1, Math.trunc(requested))) : 200;
  return NextResponse.json({ logs: await listDiagnosticLogs(limit) });
}
