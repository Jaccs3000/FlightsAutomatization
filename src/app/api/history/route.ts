import { NextResponse } from "next/server";
import { listRuns } from "@/lib/db";

export async function GET() { return NextResponse.json({ runs: await listRuns(150) }); }
