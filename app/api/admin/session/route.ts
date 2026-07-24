import { NextResponse } from "next/server";
import { getAdminSession, isAdminSessionConfigured } from "@/lib/admin-auth";
import { getSupabaseRestConfig } from "@/lib/repositories/supabase-rest";

export const runtime = "nodejs";

export async function GET() {
  const sessionConfigured = isAdminSessionConfigured();
  const supabaseConfigured = Boolean(getSupabaseRestConfig());

  if (!sessionConfigured || !supabaseConfigured) {
    return NextResponse.json({
      authenticated: false,
      configured: false,
      sessionConfigured,
      supabaseConfigured
    });
  }

  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({
      authenticated: false,
      configured: true,
      sessionConfigured: true,
      supabaseConfigured: true
    });
  }

  return NextResponse.json({
    authenticated: true,
    configured: true,
    sessionConfigured: true,
    supabaseConfigured: true,
    email: session.email,
    adminUserId: session.adminUserId
  });
}
