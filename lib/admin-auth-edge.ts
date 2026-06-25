import { ADMIN_SESSION_COOKIE, isAdminSessionConfigured } from "./admin-session-config.ts";

type AdminSessionPayload = {
  adminUserId: string;
  email: string;
  exp: number;
};

export { ADMIN_SESSION_COOKIE };

export async function verifyAdminSessionTokenEdge(token: string | undefined): Promise<boolean> {
  if (!token || !isAdminSessionConfigured()) return false;

  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) return false;

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return false;

  const expectedSignature = await signPayloadEdge(encodedPayload, secret);
  if (!timingSafeEqualString(signature, expectedSignature)) return false;

  try {
    const session = JSON.parse(decodeBase64Url(encodedPayload)) as AdminSessionPayload;
    if (!session.adminUserId || !session.email || typeof session.exp !== "number") return false;
    if (session.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

async function signPayloadEdge(encodedPayload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload));
  return bufferToBase64Url(signature);
}

function bufferToBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + padding);
}

function timingSafeEqualString(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
