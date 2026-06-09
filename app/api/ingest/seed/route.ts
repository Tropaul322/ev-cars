import { NextResponse } from "next/server";
import { upsertSeedVehicles } from "@/lib/repositories/vehicle-repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = process.env.INGEST_ADMIN_TOKEN;
  if (token && request.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await upsertSeedVehicles();
  const status = result.mode === "supabase-error" ? 502 : 200;
  return NextResponse.json(result, { status });
}
