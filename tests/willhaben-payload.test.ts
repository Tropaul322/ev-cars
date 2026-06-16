import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareWillhabenVehicleForUpload,
  sanitizeWillhabenRaw,
  WILLHABEN_RAW_OMIT_FIELDS,
  type WillhabenInventoryRow
} from "../lib/inventory/willhaben-payload.ts";

test("sanitizeWillhabenRaw removes marketplace noise and keeps listing metadata", () => {
  const raw = {
    id: "2062053964",
    uuid: "b1854dc1-ab93-406e-a3c8-b34e9d305250",
    description: "Hyundai Ioniq 5",
    publishedDate: "2026-06-12T12:30:00+0200",
    attributes: { attribute: [{ name: "PRICE", values: ["42660"] }] },
    advertImageList: { advertImage: [] },
    loginId: -1,
    seoMetaData: { title: "ignored" }
  };

  const sanitized = sanitizeWillhabenRaw(raw);
  assert.ok(sanitized);
  assert.equal(sanitized.id, "2062053964");
  assert.equal(sanitized.description, "Hyundai Ioniq 5");
  assert.equal(sanitized.publishedDate, "2026-06-12T12:30:00+0200");
  assert.equal("attributes" in sanitized, false);
  assert.equal("advertImageList" in sanitized, false);
  assert.equal("loginId" in sanitized, false);
  assert.equal("seoMetaData" in sanitized, false);
});

test("prepareWillhabenVehicleForUpload fills required defaults and strips raw fields", () => {
  const vehicle = prepareWillhabenVehicleForUpload({
    id: "willhaben:1",
    source: "willhaben",
    market: "AT",
    make: "Hyundai",
    model: "Ioniq 5",
    trim: "Comfort",
    priceEUR: 42660,
    condition: "new",
    mileageKm: 0,
    warranty: "-1",
    bodyType: "other",
    seats: 5,
    powerKw: 56,
    available: true,
    features: [],
    images: ["https://cache.willhaben.at/mmo/example.jpg"],
    notes: "test",
    brandOrigin: "korea",
    reviewTags: [],
    raw: {
      id: "1",
      description: "listing",
      attributes: { attribute: [] },
      organisationDetails: { orgName: "Dealer" }
    }
  } as unknown as WillhabenInventoryRow);

  assert.equal(vehicle.year, 2026);
  assert.equal(vehicle.bodyType, "other");
  assert.equal(vehicle.brandOrigin, "korea");
  assert.equal(vehicle.rangeKm > 0, true);
  assert.equal(vehicle.drivetrain, "RWD");
  assert.deepEqual(Object.keys(vehicle.raw ?? {}).sort(), ["description", "id"]);
});

test("omit list covers all excluded willhaben raw keys", () => {
  const excluded = new Set(WILLHABEN_RAW_OMIT_FIELDS);
  const expected = [
    "loginId",
    "attributes",
    "advertImageList",
    "organisationDetails",
    "seoMetaData"
  ];
  for (const key of expected) {
    assert.equal(excluded.has(key as (typeof WILLHABEN_RAW_OMIT_FIELDS)[number]), true, `expected ${key} to be omitted`);
  }
});
