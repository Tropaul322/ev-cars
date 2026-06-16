import assert from "node:assert/strict";
import test from "node:test";
import { emptyCriteria } from "../lib/criteria.ts";
import { buildVehicleSearchParams } from "../lib/repositories/vehicle-repository.ts";

test("vehicle search pushes generated-column criteria into the Supabase request", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Used Kia SUV under 50000 EUR with 450 km range"),
    budgetMaxEUR: 50000,
    monthlyBudgetEUR: 650,
    rangeFloorKm: 450,
    mileageMaxKm: 30000,
    preferredCondition: "used",
    bodyTypes: ["suv", "crossover"],
    brandPreferences: ["Kia"],
    modelPreferences: ["EV6"],
    preferredBrandOrigins: ["korea"],
    passengers: 5
  });

  assert.equal(params.get("market"), "eq.AT");
  assert.equal(params.get("available"), "eq.true");
  assert.equal(params.get("price_eur"), "lte.50000");
  assert.equal(params.get("condition"), "eq.used");
  assert.equal(params.get("range_km"), "gte.450");
  assert.equal(params.get("body_type"), "in.(suv,crossover)");
  assert.equal(params.get("brand_origin"), "in.(korea)");
  assert.equal(params.get("seats"), "gte.5");
  assert.equal(params.get("mileage_km"), "lte.30000");
  assert.equal(params.get("or"), "(monthly_lease_eur.is.null,monthly_lease_eur.lte.650)");
  assert.equal(params.get("order"), "price_eur.asc,range_km.desc");
  assert.equal(params.has("and"), false);
  assert.equal(params.has("brand"), false);
  assert.equal(params.has("model"), false);
});
