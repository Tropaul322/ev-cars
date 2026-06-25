import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionTokenEdge } from "@/lib/admin-auth-edge";
import { updateSession } from "@/utils/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublicAdminPath = pathname === "/admin" || pathname === "/admin/login";

  if (pathname.startsWith("/admin") && !isPublicAdminPath) {
    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    const authenticated = await verifyAdminSessionTokenEdge(token);
    if (!authenticated) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/admin";
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (isPublicAdminPath) {
    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    const authenticated = await verifyAdminSessionTokenEdge(token);
    if (authenticated) {
      const usersUrl = request.nextUrl.clone();
      usersUrl.pathname = "/admin/users";
      usersUrl.search = "";
      return NextResponse.redirect(usersUrl);
    }
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
