import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createDemoRegistration,
  DEMO_REGISTRATION_COOKIE,
  getDemoRegistration,
  isActiveDemoRegistration,
  requestDemoRegistrationDeletion,
  validateDemoRegistration
} from "@/lib/demo-registration";

export const runtime = "nodejs";

type DemoRegistrationRequest = {
  name?: string;
  email?: string;
  location?: string;
  consent?: boolean;
};

export async function GET() {
  const cookieStore = await cookies();
  const registration = await getDemoRegistration(cookieStore.get(DEMO_REGISTRATION_COOKIE)?.value);

  if (!isActiveDemoRegistration(registration)) {
    return NextResponse.json({ registered: false });
  }

  return NextResponse.json({
    registered: true,
    tester: {
      name: registration!.name,
      email: registration!.email,
      location: registration!.location
    }
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as DemoRegistrationRequest;
  const result = validateDemoRegistration({
    name: body.name ?? "",
    email: body.email ?? "",
    location: body.location ?? "",
    consent: body.consent === true
  });

  if (!result.clean) {
    return NextResponse.json({ error: result.error ?? "Invalid registration." }, { status: 400 });
  }

  const registration = await createDemoRegistration(result.clean);
  const response = NextResponse.json({
    registered: true,
    tester: {
      name: registration.name,
      email: registration.email,
      location: registration.location
    }
  });
  response.cookies.set(DEMO_REGISTRATION_COOKIE, registration.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/"
  });
  return response;
}

export async function DELETE() {
  const cookieStore = await cookies();
  await requestDemoRegistrationDeletion(cookieStore.get(DEMO_REGISTRATION_COOKIE)?.value);

  const response = NextResponse.json({ registered: false, deletionRequested: true });
  response.cookies.set(DEMO_REGISTRATION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/"
  });
  return response;
}
