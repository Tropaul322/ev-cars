import crypto from "node:crypto";
import { isAdminSessionConfigured } from "./admin-session-config.ts";

export { ADMIN_SESSION_COOKIE, isAdminSessionConfigured } from "./admin-session-config.ts";

const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type AdminSession = {
  adminUserId: string;
  email: string;
  exp: number;
};

export type AdminLoginInput = {
  email: string;
  password: string;
};

/** @deprecated Use isAdminSessionConfigured */
export function isAdminConfigured(): boolean {
  return isAdminSessionConfigured();
}

export function createAdminSessionToken(input: { adminUserId: string; email: string }): string {
  const secret = getSessionSecret();
  const payload: AdminSession = {
    adminUserId: input.adminUserId,
    email: input.email.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function parseAdminSessionToken(token: string | undefined): AdminSession | null {
  if (!token || !isAdminSessionConfigured()) return null;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const secret = getSessionSecret();
  const expectedSignature = signPayload(encodedPayload, secret);
  if (!timingSafeEqualString(signature, expectedSignature)) return null;

  try {
    const session = JSON.parse(decodeBase64Url(encodedPayload)) as AdminSession;
    if (!session.adminUserId || !session.email || typeof session.exp !== "number") return null;
    if (session.exp < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

export function adminSessionMaxAgeSeconds() {
  return SESSION_TTL_SECONDS;
}

function getSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters.");
  }
  return secret;
}

function signPayload(encodedPayload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function timingSafeEqualString(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
