import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DEMO_REGISTRATION_COOKIE,
  getDemoRegistration,
  isActiveDemoRegistration
} from "@/lib/demo-registration";
import { runMatchRequest } from "@/lib/match-service";
import type { UserCriteria } from "@/lib/types";

export const runtime = "nodejs";

type MatchRequest = {
  message?: string;
  sessionId?: string;
  previousCriteria?: UserCriteria;
  criteriaOverride?: UserCriteria;
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const registration = await getDemoRegistration(cookieStore.get(DEMO_REGISTRATION_COOKIE)?.value);

  if (!isActiveDemoRegistration(registration)) {
    return NextResponse.json({ error: "Demo registration is required." }, { status: 401 });
  }

  const body = (await request.json()) as MatchRequest;
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const response = await runMatchRequest({
    message,
    sessionId: body.sessionId,
    previousCriteria: body.previousCriteria,
    criteriaOverride: body.criteriaOverride,
    testerLocation: registration!.location
  });
  return NextResponse.json(response);
}
