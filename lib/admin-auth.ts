import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionMaxAgeSeconds,
  createAdminSessionToken,
  parseAdminSessionToken,
  type AdminSession
} from "./admin-auth-session.ts";
import { getAdminUserById } from "./repositories/admin-user-repository.ts";

export {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  isAdminConfigured,
  isAdminSessionConfigured,
  parseAdminSessionToken,
  type AdminLoginInput,
  type AdminSession
} from "./admin-auth-session.ts";

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const session = parseAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
  if (!session) return null;

  const user = await getAdminUserById(session.adminUserId);
  if (!user?.active || user.email !== session.email) return null;

  return session;
}

export async function requireAdminSession(): Promise<AdminSession | null> {
  return getAdminSession();
}

export function setAdminSessionCookie(
  response: NextResponse,
  session: { adminUserId: string; email: string }
) {
  response.cookies.set(ADMIN_SESSION_COOKIE, createAdminSessionToken(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: adminSessionMaxAgeSeconds(),
    path: "/"
  });
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/"
  });
}
