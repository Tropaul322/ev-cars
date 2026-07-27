import test from "node:test";
import assert from "node:assert/strict";
import { resolveBuyNowAction } from "../lib/buy-now.ts";

test("resolveBuyNowAction opens listing URL for registered users", () => {
  const registered = resolveBuyNowAction({
    registered: true,
    listingUrl: "https://example.com/car/1",
    carPagePath: "/car/abc",
  });
  assert.equal(registered.kind, "open_url");
  assert.equal(registered.href, "https://example.com/car/1");

  const registeredInternal = resolveBuyNowAction({
    registered: true,
    listingUrl: undefined,
    carPagePath: "/car/abc",
  });
  assert.equal(registeredInternal.kind, "open_url");
  assert.equal(registeredInternal.href, "/car/abc");

  const guest = resolveBuyNowAction({
    registered: false,
    listingUrl: "https://example.com/car/1",
    carPagePath: "/car/abc",
  });
  assert.equal(guest.kind, "require_registration");
});
