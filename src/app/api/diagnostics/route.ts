import { NextResponse } from "next/server";
import { listDiagnosticLogs } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ logs: await listDiagnosticLogs(200) });
}
