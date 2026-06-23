import { NextResponse } from "next/server";
import { VEHICLE_REVALIDATE_SECONDS } from "@/lib/cache";
import { getVehicleById } from "@/lib/repositories/vehicle-repository";

export const runtime = "nodejs";
export const revalidate = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const vehicle = await getVehicleById(id);

  if (!vehicle) {
    return NextResponse.json({ error: "vehicle not found" }, { status: 404 });
  }

  return NextResponse.json(
    { vehicle },
    {
      headers: {
        "Cache-Control": `public, s-maxage=${VEHICLE_REVALIDATE_SECONDS}, stale-while-revalidate=${VEHICLE_REVALIDATE_SECONDS * 2}`,
      },
    },
  );
}
