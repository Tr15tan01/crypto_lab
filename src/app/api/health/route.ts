import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness probe for monitoring. Reveals nothing about configuration or data. */
export function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}
