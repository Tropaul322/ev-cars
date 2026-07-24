import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DEMO_REGISTRATION_COOKIE,
  getDemoRegistration,
  isActiveDemoRegistration
} from "@/lib/demo-registration";
import {
  listSavedCars,
  saveCar,
  type SavedCarSnapshot
} from "@/lib/repositories/saved-car-repository";

export const runtime = "nodejs";

type SaveCarRequest = {
  vehicleId?: string;
  snapshot?: SavedCarSnapshot | null;
};

export async function GET() {
  const registration = await getActiveRegistration();
  if (!registration) {
    return NextResponse.json({ error: "Demo registration is required." }, { status: 401 });
  }

  const savedCars = await listSavedCars(registration.id);
  return NextResponse.json({ savedCars, count: savedCars.length });
}

export async function POST(request: Request) {
  const registration = await getActiveRegistration();
  if (!registration) {
    return NextResponse.json({ error: "Demo registration is required." }, { status: 401 });
  }

  const body = (await request.json()) as SaveCarRequest;
  const vehicleId = body.vehicleId?.trim();
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicleId is required" }, { status: 400 });
  }

  const result = await saveCar(registration.id, vehicleId, body.snapshot ?? null);
  if (!result.saved) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ saved: true });
}

async function getActiveRegistration() {
  const cookieStore = await cookies();
  const registration = await getDemoRegistration(cookieStore.get(DEMO_REGISTRATION_COOKIE)?.value);
  return isActiveDemoRegistration(registration) ? registration : null;
}
