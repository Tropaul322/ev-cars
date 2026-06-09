import { NextResponse } from "next/server";
import { getVehicleById } from "@/lib/repositories/vehicle-repository";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const vehicle = await getVehicleById(id);

  if (!vehicle) {
    return NextResponse.json({ error: "vehicle not found" }, { status: 404 });
  }

  return NextResponse.json({ vehicle });
}
