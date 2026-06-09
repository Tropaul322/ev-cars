import { NextResponse } from "next/server";
import { listVehicles } from "@/lib/repositories/vehicle-repository";

export const runtime = "nodejs";

export async function GET() {
  const vehicles = await listVehicles();
  return NextResponse.json({ vehicles, count: vehicles.length });
}
