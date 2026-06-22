import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DEMO_REGISTRATION_COOKIE,
  getDemoRegistration,
  isActiveDemoRegistration
} from "@/lib/demo-registration";
import { getChatWithMessages } from "@/lib/repositories/chat-repository";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const cookieStore = await cookies();
  const registration = await getDemoRegistration(cookieStore.get(DEMO_REGISTRATION_COOKIE)?.value);

  if (!isActiveDemoRegistration(registration)) {
    return NextResponse.json({ error: "Demo registration is required." }, { status: 401 });
  }

  const { chatId } = await params;
  const chat = await getChatWithMessages(registration!.id, decodeURIComponent(chatId));
  if (!chat) {
    return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  }

  return NextResponse.json({ chat });
}
