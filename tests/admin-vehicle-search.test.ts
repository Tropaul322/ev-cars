import test from "node:test";
import assert from "node:assert/strict";
import { buildAdminVehicleListParams } from "../lib/repositories/admin-vehicle-repository.ts";

test("buildAdminVehicleListParams applies search, filters, and pagination", () => {
  const params = buildAdminVehicleListParams(
    {
      q: "id3",
      make: "Volkswagen",
      condition: "used",
      bodyType: "hatchback",
      location: "Wien",
      priceMinEUR: 20000,
      priceMaxEUR: 50000,
      includeUnavailable: true
    },
    2,
    20
  );

  assert.equal(params.get("limit"), "20");
  assert.equal(params.get("offset"), "20");
  assert.equal(params.get("available"), null);
  assert.match(params.get("or") ?? "", /make\.ilike\.\*id3\*/);
  assert.match(params.get("make") ?? "", /ilike\.\*Volkswagen\*/);
  assert.equal(params.get("condition"), "eq.used");
  assert.equal(params.get("body_type"), "eq.hatchback");
  assert.match(params.get("location") ?? "", /ilike\.\*Wien\*/);
  assert.equal(params.getAll("price_eur").join(","), "gte.20000,lte.50000");
});

test("buildAdminVehicleListParams defaults to available vehicles only", () => {
  const params = buildAdminVehicleListParams({}, 1, 20);
  assert.equal(params.get("available"), "eq.true");
  assert.equal(params.get("offset"), "0");
});
