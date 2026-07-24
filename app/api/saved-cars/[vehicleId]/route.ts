import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DEMO_REGISTRATION_COOKIE,
  getDemoRegistration,
  isActiveDemoRegistration
} from "@/lib/demo-registration";
import { unsaveCar } from "@/lib/repositories/saved-car-repository";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ vehicleId: string }> }
) {
  const registration = await getActiveRegistration();
  if (!registration) {
    return NextResponse.json({ error: "Demo registration is required." }, { status: 401 });
  }

  const { vehicleId } = await params;
  const result = await unsaveCar(registration.id, decodeURIComponent(vehicleId));
  if (result.saved) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ saved: false });
}

async function getActiveRegistration() {
  const cookieStore = await cookies();
  const registration = await getDemoRegistration(cookieStore.get(DEMO_REGISTRATION_COOKIE)?.value);
  return isActiveDemoRegistration(registration) ? registration : null;
}
