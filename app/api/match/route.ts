import { NextResponse } from "next/server";
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
  const body = (await request.json()) as MatchRequest;
  const message = body.message?.trim();

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const response = await runMatchRequest({
    message,
    sessionId: body.sessionId,
    previousCriteria: body.previousCriteria,
    criteriaOverride: body.criteriaOverride
  });
  return NextResponse.json(response);
}
