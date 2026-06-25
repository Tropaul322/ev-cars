import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaultVehicle,
  decodeVehicleRouteId,
  generateVehicleId,
  normalizeVehiclePayload,
  adminVehicleApiPath,
  adminVehicleEditPath
} from "../lib/admin-vehicle-helpers.ts";

test("generateVehicleId slugifies make, model, and year", () => {
  assert.equal(generateVehicleId("Volkswagen", "ID.3", 2023), "volkswagen-id-3-2023");
});

test("buildDefaultVehicle applies inventory defaults", () => {
  const vehicle = buildDefaultVehicle({
    make: "BMW",
    model: "i4",
    year: 2022
  });

  assert.equal(vehicle.market, "AT");
  assert.equal(vehicle.source, "seed");
  assert.equal(vehicle.available, true);
  assert.equal(vehicle.make, "BMW");
  assert.match(vehicle.id, /bmw-i4-2022/);
});

test("decodeVehicleRouteId restores encoded inventory ids", () => {
  assert.equal(decodeVehicleRouteId("willhaben%3A791377302"), "willhaben:791377302");
  assert.equal(decodeVehicleRouteId("bmw-i4-edrive40-2022"), "bmw-i4-edrive40-2022");
});

test("admin vehicle paths encode ids for routing", () => {
  assert.equal(
    adminVehicleEditPath("willhaben:791377302"),
    "/admin/vehicles/willhaben%3A791377302/edit"
  );
  assert.equal(
    adminVehicleApiPath("willhaben:791377302"),
    "/api/admin/vehicles/willhaben%3A791377302"
  );
});

test("normalizeVehiclePayload coerces partial inventory payloads for admin editing", () => {
  const vehicle = normalizeVehiclePayload(
    buildDefaultVehicle({
      id: "crawled-listing-1",
      make: "Tesla",
      model: "Model 3",
      year: 2021,
      priceEUR: 38900,
      rangeKm: 448,
      available: false
    })
  );

  assert.equal(vehicle.id, "crawled-listing-1");
  assert.equal(vehicle.make, "Tesla");
  assert.equal(vehicle.available, false);
  assert.deepEqual(vehicle.features, []);
  assert.deepEqual(vehicle.images, []);
  assert.deepEqual(vehicle.reviewTags, []);
});
