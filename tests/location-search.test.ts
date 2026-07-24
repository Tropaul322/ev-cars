import assert from "node:assert/strict";
import test from "node:test";
import {
  isPostalLocationCode,
  normalizeLocationSearchTerm,
  resolveInventoryLocationFilter
} from "../lib/location-search.ts";
import { inferSearchRangeFloorKm, isPlausiblePurchasePrice } from "../lib/vehicle-search-helpers.ts";

test("normalizeLocationSearchTerm maps Vienna to Wien", () => {
  assert.equal(normalizeLocationSearchTerm("Vienna"), "Wien");
});

test("postal location codes are not used as hard inventory location filters", () => {
  assert.equal(isPostalLocationCode("1010"), true);
  assert.equal(isPostalLocationCode("Wien"), false);
  assert.equal(resolveInventoryLocationFilter("1010"), null);
  assert.equal(resolveInventoryLocationFilter("Vienna"), "Wien");
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
