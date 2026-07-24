import test from "node:test";
import assert from "node:assert/strict";
import {
  createAdminSessionToken,
  isAdminSessionConfigured,
  parseAdminSessionToken
} from "../lib/admin-auth-session.ts";

const originalSecret = process.env.ADMIN_SESSION_SECRET;

test.afterEach(() => {
  if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = originalSecret;
});

test("isAdminSessionConfigured requires session secret", () => {
  delete process.env.ADMIN_SESSION_SECRET;
  assert.equal(isAdminSessionConfigured(), false);

  process.env.ADMIN_SESSION_SECRET = "x".repeat(32);
  assert.equal(isAdminSessionConfigured(), true);
});

test("admin session token round-trips and rejects tampering", () => {
  process.env.ADMIN_SESSION_SECRET = "x".repeat(32);

  const token = createAdminSessionToken({
    adminUserId: "11111111-1111-1111-1111-111111111111",
    email: "admin@flowryd.test"
  });
  const session = parseAdminSessionToken(token);

  assert.equal(session?.email, "admin@flowryd.test");
  assert.equal(session?.adminUserId, "11111111-1111-1111-1111-111111111111");
  assert.ok((session?.exp ?? 0) > Math.floor(Date.now() / 1000));

  const [payload] = token.split(".");
  const tampered = `${payload}.invalid-signature`;
  assert.equal(parseAdminSessionToken(tampered), null);
});
