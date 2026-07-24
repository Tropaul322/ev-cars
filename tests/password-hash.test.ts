import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../lib/password-hash.ts";

test("hashPassword and verifyPassword round-trip", () => {
  const hash = hashPassword("secret-password");
  assert.match(hash, /^scrypt:/);
  assert.equal(verifyPassword("secret-password", hash), true);
  assert.equal(verifyPassword("wrong-password", hash), false);
});

test("verifyPassword rejects malformed hashes", () => {
  assert.equal(verifyPassword("secret-password", "not-a-valid-hash"), false);
});
