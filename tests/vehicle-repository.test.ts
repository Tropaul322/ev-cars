import assert from "node:assert/strict";
import test from "node:test";
import { emptyCriteria } from "../lib/criteria.ts";
import { buildVehicleSearchParams } from "../lib/repositories/vehicle-repository.ts";

test("vehicle search pushes generated-column criteria into the Supabase request", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria(
      "Only used Korean Kia SUV under 50000 EUR with at least 450 km range that must seat 5"
    ),
    budgetMaxEUR: 50000,
    monthlyBudgetEUR: 650,
    rangeFloorKm: 450,
    mileageMaxKm: 30000,
    preferredCondition: "used",
    bodyTypes: ["suv", "crossover"],
    brandPreferences: ["Kia"],
    modelPreferences: ["EV6"],
    preferredBrandOrigins: ["korea"],
    passengers: 5,
    latestUserMessage:
      "Only used Korean Kia SUV under 50000 EUR with at least 450 km range that must seat 5"
  });

  assert.equal(params.get("market"), "eq.AT");
  assert.equal(params.get("available"), "eq.true");
  assert.equal(params.get("price_eur"), "lte.50000");
  assert.equal(params.get("condition"), "eq.used");
  assert.equal(params.get("range_km"), "gte.450");
  assert.equal(params.get("body_type"), "in.(suv,crossover)");
  assert.equal(params.get("brand"), "in.(Kia)");
  assert.equal(params.get("seats"), "gte.5");
  assert.equal(params.get("mileage_km"), "lte.30000");
  assert.equal(params.get("limit"), "120");
  assert.equal(
    params.get("and"),
    "(or(brand_origin.in.(korea),manufacturer_country_code.in.(KR)),or(monthly_lease_eur.is.null,monthly_lease_eur.lte.650),or(model.ilike.*EV6*,title.ilike.*EV6*))"
  );
  assert.equal(params.get("order"), "range_km.desc,price_eur.asc");
  assert.equal(params.has("or"), false);
  assert.equal(params.has("brand_origin"), false);
});

test("vehicle search expands brand aliases for preferred brands when hard", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Only VW or Mercedes"),
    brandPreferences: ["VW", "Mercedes-Benz"],
    latestUserMessage: "Only VW or Mercedes"
  });

  assert.equal(params.get("brand"), "in.(VW,Volkswagen,Mercedes-Benz,Mercedes)");
});

test("vehicle search keeps soft brand preferences out of SQL filters", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Looking for a VW or Mercedes"),
    brandPreferences: ["VW", "Mercedes-Benz"],
    latestUserMessage: "Looking for a VW or Mercedes"
  });

  assert.equal(params.get("brand"), null);
});

test("vehicle search applies avoided brands", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("No Tesla"),
    avoidedBrands: ["Tesla"]
  });

  assert.equal(params.get("brand"), "not.in.(Tesla)");
});

test("vehicle search expands Vienna to Wien for location lookup", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Tesla in Vienna"),
    location: "Vienna"
  });

  assert.equal(params.get("location"), "ilike.*Wien*");
});

test("vehicle search ignores postal codes as hard location filters", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Budget EV near me with at least 400 km range"),
    location: "1010",
    budgetMaxEUR: 30000,
    rangeFloorKm: 400
  });

  assert.equal(params.get("location"), null);
  assert.equal(params.get("price_eur"), "lte.30000");
  assert.equal(params.get("range_km"), "gte.400");
});

test("vehicle search applies location and origin fallbacks", () => {
  const params = buildVehicleSearchParams({
    ...emptyCriteria("Only Korean EV in Wien"),
    preferredBrandOrigins: ["korea"],
    location: "Wien",
    latestUserMessage: "Only Korean EV in Wien"
  });

  assert.equal(params.get("location"), "ilike.*Wien*");
  assert.equal(
    params.get("or"),
    "(brand_origin.in.(korea),manufacturer_country_code.in.(KR))"
  );
});
