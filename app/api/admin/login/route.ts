import { NextResponse } from "next/server";
import { isAdminSessionConfigured, setAdminSessionCookie } from "@/lib/admin-auth";
import { authenticateAdminUser } from "@/lib/repositories/admin-user-repository";
import { getSupabaseRestConfig } from "@/lib/repositories/supabase-rest";

export const runtime = "nodejs";

type AdminLoginRequest = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  if (!isAdminSessionConfigured()) {
    return NextResponse.json({ error: "Admin session secret is not configured." }, { status: 503 });
  }

  if (!getSupabaseRestConfig()) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const body = (await request.json()) as AdminLoginRequest;
  const email = body.email?.trim() ?? "";
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const adminUser = await authenticateAdminUser(email, password);
  if (!adminUser) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const response = NextResponse.json({
    authenticated: true,
    email: adminUser.email,
    adminUserId: adminUser.id
  });
  setAdminSessionCookie(response, { adminUserId: adminUser.id, email: adminUser.email });
  return response;
}
