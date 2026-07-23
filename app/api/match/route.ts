import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DEMO_REGISTRATION_COOKIE,
  getDemoRegistration,
  isActiveDemoRegistration
} from "@/lib/demo-registration";
import { runMatchRequest } from "@/lib/match-service";
import {
  ensureChatSession,
  getChatSession,
  saveChatMessage
} from "@/lib/repositories/chat-repository";
import type { ClarificationPromptKey, CriteriaPatch, MissingCriteria, UserCriteria } from "@/lib/types";

export const runtime = "nodejs";

type MatchRequest = {
  message?: string;
  sessionId?: string;
  previousCriteria?: UserCriteria;
  criteriaOverride?: UserCriteria;
  criteriaPatch?: CriteriaPatch;
  intent?: "show_matches" | "show_alternatives";
  skippedKeys?: MissingCriteria[];
  currentPromptKey?: ClarificationPromptKey;
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

  const requestedSessionId = body.sessionId?.trim();
  const existingChat = requestedSessionId ? await getChatSession(registration!.id, requestedSessionId) : null;
  const sessionId = existingChat ? existingChat.id : crypto.randomUUID();
  await ensureChatSession(registration!.id, sessionId, message);
  await saveChatMessage({
    chatSessionId: sessionId,
    testerRegistrationId: registration!.id,
    role: "user",
    content: message
  });

  const response = await runMatchRequest({
    message,
    sessionId,
    testerRegistrationId: registration!.id,
    previousCriteria: body.previousCriteria,
    criteriaOverride: body.criteriaOverride,
    criteriaPatch: body.criteriaPatch,
    intent: body.intent,
    skippedKeys: body.skippedKeys,
    currentPromptKey: body.currentPromptKey,
    testerLocation: registration!.location
  });
  await saveChatMessage({
    chatSessionId: response.sessionId,
    testerRegistrationId: registration!.id,
    role: "assistant",
    content: response.assistantMessage,
    payload: {
      matchResponse: response
    }
  });
  return NextResponse.json(response);
}
