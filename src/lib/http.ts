import { NextResponse, type NextRequest } from "next/server";

export function requireLocalOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.json({ error: "Falta el origen de la solicitud." }, { status: 403 });
  try {
    const url = new URL(origin);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return NextResponse.json({ error: "La app solo acepta solicitudes locales." }, { status: 403 });
    const host = request.headers.get("host")?.split(":")[0];
    if (host && host !== url.hostname.replace(/[\[\]]/g, "")) return NextResponse.json({ error: "El origen no coincide con la app." }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Origen de solicitud inválido." }, { status: 403 });
  }
  return null;
}

export function errorResponse(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Ocurrió un error inesperado." }, { status });
}
