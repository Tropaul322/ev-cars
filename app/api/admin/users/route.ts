import { NextResponse } from "next/server";
import { requireAdminApiSession } from "@/lib/admin-api";
import { listAllTesterRegistrations } from "@/lib/repositories/admin-repository";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdminApiSession();
  if (auth.response) return auth.response;

  const users = await listAllTesterRegistrations();
  return NextResponse.json({ users });
}
