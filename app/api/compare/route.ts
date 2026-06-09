import { NextResponse } from "next/server";
import { emptyCriteria } from "@/lib/criteria";
import { getVehicleById } from "@/lib/repositories/vehicle-repository";
import { calculateTco } from "@/lib/tco";
import type { UserCriteria, Vehicle } from "@/lib/types";

export const runtime = "nodejs";

type CompareRequest = {
  vehicleIds?: string[];
  criteria?: UserCriteria;
};

export async function POST(request: Request) {
  const body = (await request.json()) as CompareRequest;
  const ids = Array.from(new Set(body.vehicleIds ?? [])).slice(0, 4);

  if (!ids.length) {
    return NextResponse.json({ error: "vehicleIds is required" }, { status: 400 });
  }

  const criteria = body.criteria ?? emptyCriteria();
  const vehicles = await Promise.all(ids.map((id) => getVehicleById(id)));
  const comparison = vehicles.filter(isVehicle).map((vehicle) => ({
    vehicle,
    tco: calculateTco(vehicle, criteria)
  }));

  return NextResponse.json({ comparison });
}

function isVehicle(vehicle: Vehicle | null): vehicle is Vehicle {
  return vehicle !== null;
}
