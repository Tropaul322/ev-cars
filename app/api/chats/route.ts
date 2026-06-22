import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DEMO_REGISTRATION_COOKIE,
  getDemoRegistration,
  isActiveDemoRegistration
} from "@/lib/demo-registration";
import { listChatSessions } from "@/lib/repositories/chat-repository";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const registration = await getDemoRegistration(cookieStore.get(DEMO_REGISTRATION_COOKIE)?.value);

  if (!isActiveDemoRegistration(registration)) {
    return NextResponse.json({ error: "Demo registration is required." }, { status: 401 });
  }

  const chats = await listChatSessions(registration!.id);
  return NextResponse.json({ chats, count: chats.length });
}
