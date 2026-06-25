import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/admin-api";
import { decodeVehicleRouteId } from "@/lib/admin-vehicle-helpers";
import {
  deactivateVehicleAdmin,
  getVehicleAdmin,
  upsertVehicleAdmin
} from "@/lib/repositories/admin-vehicle-repository";
import type { Vehicle } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  const { id: rawId } = await context.params;
  const id = decodeVehicleRouteId(rawId);
  const vehicle = await getVehicleAdmin(id);
  if (!vehicle) {
    return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  }

  return NextResponse.json({ vehicle });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  const { id: rawId } = await context.params;
  const id = decodeVehicleRouteId(rawId);
  const existing = await getVehicleAdmin(id);
  if (!existing) {
    return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
  }

  const body = (await request.json()) as Partial<Vehicle>;
  const vehicle: Vehicle = { ...existing, ...body, id };
  const result = await upsertVehicleAdmin(vehicle);

  if (!result.saved) {
    return NextResponse.json({ error: result.error ?? "Failed to update vehicle." }, { status: 502 });
  }

  return NextResponse.json(result);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  const { id: rawId } = await context.params;
  const id = decodeVehicleRouteId(rawId);
  const result = await deactivateVehicleAdmin(id);

  if (!result.saved) {
    return NextResponse.json({ error: result.error ?? "Failed to deactivate vehicle." }, { status: 502 });
  }

  return NextResponse.json(result);
}
