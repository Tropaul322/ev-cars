import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLocationSearchTerm } from "../lib/location-search.ts";
import { inferSearchRangeFloorKm, isPlausiblePurchasePrice } from "../lib/vehicle-search-helpers.ts";

test("normalizeLocationSearchTerm maps Vienna to Wien", () => {
  assert.equal(normalizeLocationSearchTerm("Vienna"), "Wien");
});

test("inferSearchRangeFloorKm uses explicit criteria range", () => {
  const floor = inferSearchRangeFloorKm({
    rangeFloorKm: 420,
    tripNeeds: ["road_trip"]
  } as Parameters<typeof inferSearchRangeFloorKm>[0]);

  assert.equal(floor, 420);
});

test("isPlausiblePurchasePrice rejects scraped lease amounts", () => {
  assert.equal(isPlausiblePurchasePrice(370, null), false);
  assert.equal(isPlausiblePurchasePrice(370, 499), false);
  assert.equal(isPlausiblePurchasePrice(18990, null), true);
});
