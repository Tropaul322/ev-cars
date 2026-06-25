export const ADMIN_SESSION_COOKIE = "flowryd_admin_session";

export function isAdminSessionConfigured(): boolean {
  const secret = process.env.ADMIN_SESSION_SECRET;
  return Boolean(secret && secret.length >= 32);
}
