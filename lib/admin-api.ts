import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";

export async function requireAdminApiSession() {
  const session = await requireAdminSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 })
    };
  }

  return { session, response: null };
}
