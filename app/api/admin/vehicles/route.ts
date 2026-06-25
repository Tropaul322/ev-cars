import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/admin-api";
import {
  buildDefaultVehicle,
  searchVehiclesAdmin,
  upsertVehicleAdmin,
  type AdminVehicleListQuery
} from "@/lib/repositories/admin-vehicle-repository";
import type { BodyType, Vehicle, VehicleCondition } from "@/lib/types";

export const runtime = "nodejs";

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseOptionalInt(value: string | null) {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parseListQuery(url: URL): AdminVehicleListQuery {
  const condition = url.searchParams.get("condition");
  const bodyType = url.searchParams.get("bodyType");

  return {
    q: url.searchParams.get("q") ?? undefined,
    make: url.searchParams.get("make") ?? undefined,
    location: url.searchParams.get("location") ?? undefined,
    condition:
      condition === "new" || condition === "used" ? (condition as VehicleCondition) : "any",
    bodyType: bodyType && bodyType !== "any" ? (bodyType as BodyType) : "any",
    priceMinEUR: parseOptionalInt(url.searchParams.get("priceMinEUR")),
    priceMaxEUR: parseOptionalInt(url.searchParams.get("priceMaxEUR")),
    includeUnavailable: url.searchParams.get("includeUnavailable") === "true",
    page: parsePositiveInt(url.searchParams.get("page"), 1),
    pageSize: parsePositiveInt(url.searchParams.get("pageSize"), 20)
  };
}

export async function GET(request: Request) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const result = await searchVehiclesAdmin(parseListQuery(url));
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  const body = (await request.json()) as Partial<Vehicle>;
  if (!body.make || !body.model || !body.year) {
    return NextResponse.json({ error: "make, model, and year are required." }, { status: 400 });
  }

  const vehicle = buildDefaultVehicle({
    ...body,
    make: body.make,
    model: body.model,
    year: body.year
  });

  const result = await upsertVehicleAdmin(vehicle);
  if (!result.saved) {
    return NextResponse.json({ error: result.error ?? "Failed to save vehicle." }, { status: 502 });
  }

  return NextResponse.json(result, { status: 201 });
}
