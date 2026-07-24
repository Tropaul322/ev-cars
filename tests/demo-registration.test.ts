import test from "node:test";
import assert from "node:assert/strict";
import {
  hasDeletionRequest,
  isActiveDemoRegistration,
  type DemoRegistration
} from "../lib/demo-registration.ts";

const baseRegistration: DemoRegistration = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  location: "Wien",
  consentAt: "2026-01-01T00:00:00.000Z",
  deletionRequestedAt: null
};

test("isActiveDemoRegistration allows access while deletion is pending", () => {
  assert.equal(isActiveDemoRegistration(baseRegistration), true);
  assert.equal(
    isActiveDemoRegistration({
      ...baseRegistration,
      deletionRequestedAt: "2026-01-02T00:00:00.000Z"
    }),
    true
  );
});

test("isActiveDemoRegistration blocks access without consent or registration", () => {
  assert.equal(isActiveDemoRegistration(null), false);
  assert.equal(
    isActiveDemoRegistration({
      ...baseRegistration,
      consentAt: ""
    }),
    false
  );
});

test("hasDeletionRequest reflects pending deletion state", () => {
  assert.equal(hasDeletionRequest(baseRegistration), false);
  assert.equal(
    hasDeletionRequest({
      ...baseRegistration,
      deletionRequestedAt: "2026-01-02T00:00:00.000Z"
    }),
    true
  );
});
