import { NextRequest, NextResponse } from "next/server";
import { findAirports } from "@/lib/airport-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (query.length > 120) return NextResponse.json({ airports: [] }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ airports: findAirports(query) }, { headers: { "Cache-Control": "no-store" } });
}
