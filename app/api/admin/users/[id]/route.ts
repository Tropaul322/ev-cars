import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/admin-api";
import {
  deleteTesterRegistrationAdmin,
  getTesterRegistrationAdmin,
  listChatSessionsForUserAdmin
} from "@/lib/repositories/admin-repository";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const user = await getTesterRegistrationAdmin(id);
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const chats = await listChatSessionsForUserAdmin(id);
  return NextResponse.json({ user, chats });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  const { id } = await context.params;
  const user = await getTesterRegistrationAdmin(id);
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const result = await deleteTesterRegistrationAdmin(id);
  if (!result.deleted) {
    return NextResponse.json({ error: result.error ?? "Failed to delete user." }, { status: 502 });
  }

  return NextResponse.json({ deleted: true });
}
