import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/admin-api";
import { getChatWithMessagesAdmin } from "@/lib/repositories/admin-repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ chatId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  const { chatId } = await context.params;
  const chat = await getChatWithMessagesAdmin(chatId);
  if (!chat) {
    return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  }

  return NextResponse.json({ chat });
}
