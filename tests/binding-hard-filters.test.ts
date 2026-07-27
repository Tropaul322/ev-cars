import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyCriteria,
  extractCriteria,
  hasHardBodyTypeConstraint,
  hasHardRangeConstraint
} from "../lib/criteria.ts";
import { applyChipPatch } from "../lib/criteria-normalizer.ts";
import { buildHybridSearchFilters } from "../lib/repositories/vehicle-repository.ts";
import { matchVehicles } from "../lib/scoring.ts";
import type { UserCriteria, Vehicle } from "../lib/types.ts";

process.env.FLOWRYD_DISABLE_LLM = "1";

function sampleVehicle(overrides: Partial<Vehicle>): Vehicle {
  return {
    id: "v1",
    source: "seed",
    market: "AT",
    make: "Test",
    model: "Car",
    trim: "Base",
    year: 2024,
    priceEUR: 40000,
    monthlyLeaseEUR: null,
    rangeKm: 500,
    batteryKwh: 70,
    efficiencyKwhPer100Km: 16,
    seats: 5,
    cargoLiters: 450,
    bodyType: "suv",
    condition: "new",
    mileageKm: 0,
    batterySoH: null,
    chargingCycles: null,
    brandOrigin: "europe",
    manufacturerCountryCode: "DE",
    location: "Wien",
    features: [],
    images: [],
    notes: "",
    warranty: "factory warranty",
    reviewTags: [],
    available: true,
    drivetrain: "RWD",
    powerKw: 150,
    ...overrides
  };
}

test("clarification body chip becomes a hard filter for any body style", () => {
  const base = {
    ...emptyCriteria("budget under 50000", "en"),
    budgetMaxEUR: 50000,
    rangeFloorKm: 350
  };
  const sedan = applyChipPatch(base, { bodyTypes: ["sedan"] });
  assert.deepEqual(sedan.bodyTypes, ["sedan"]);
  assert.equal(sedan.bindingConstraints.bodyTypes, true);
  assert.equal(hasHardBodyTypeConstraint(sedan), true);

  const wagon = applyChipPatch(base, { bodyTypes: ["wagon"] });
  assert.equal(hasHardBodyTypeConstraint(wagon), true);
  assert.deepEqual(buildHybridSearchFilters(wagon).hardBodyTypes, ["wagon"]);
});

test("body chip replaces prior soft body preference instead of merging", () => {
  const previous = {
    ...emptyCriteria("Looking for an SUV under 50000 EUR", "en"),
    budgetMaxEUR: 50000,
    bodyTypes: ["suv"] as UserCriteria["bodyTypes"]
  };
  const next = applyChipPatch(previous, { bodyTypes: ["sedan"] });
  assert.deepEqual(next.bodyTypes, ["sedan"]);
  assert.equal(hasHardBodyTypeConstraint(next), true);
});

test("range chip marks range floor as hard search filter", () => {
  const base = {
    ...emptyCriteria("SUV under 60000", "en"),
    budgetMaxEUR: 60000,
    bodyTypes: ["suv"] as UserCriteria["bodyTypes"]
  };
  const next = applyChipPatch(base, { rangeFloorKm: 450 });
  assert.equal(next.rangeFloorKm, 450);
  assert.equal(next.bindingConstraints.rangeFloor, true);
  assert.equal(hasHardRangeConstraint(next), true);
  assert.equal(buildHybridSearchFilters(next).hardRangeFloorKm, 450);
});

test("thin limousine reply replaces SUV and hard-filters sedans", () => {
  const previous = extractCriteria("Looking for an SUV under 50000 EUR");
  assert.equal(hasHardBodyTypeConstraint(previous), false);

  const next = extractCriteria("Limousine", previous);
  assert.deepEqual(next.bodyTypes, ["sedan"]);
  assert.equal(hasHardBodyTypeConstraint(next), true);

  const suv = sampleVehicle({ id: "suv", bodyType: "suv", make: "MG", model: "MGS6", rangeKm: 433 });
  const sedan = sampleVehicle({
    id: "sedan",
    bodyType: "sedan",
    make: "Xpeng",
    model: "P7+",
    rangeKm: 530,
    brandOrigin: "china"
  });
  const result = matchVehicles([suv, sedan], next, 2);
  assert.ok(result.recommendations.every((match) => match.vehicle.bodyType === "sedan"));
  assert.ok(result.rejected.some((item) => item.vehicle.id === "suv"));
});

test("status wish ranks premium brands above mass-market makes", () => {
  const criteria = applyChipPatch(
    {
      ...emptyCriteria("sedan under 60000 with 450 km", "en"),
      budgetMaxEUR: 60000,
      bodyTypes: ["sedan"],
      rangeFloorKm: 450,
      bindingConstraints: { bodyTypes: true, rangeFloor: true }
    },
    { personalWish: "status" }
  );
  assert.ok(criteria.qualitativeSignals.includes("premium"));

  const mg = sampleVehicle({
    id: "mg",
    make: "MG",
    model: "MGS6",
    bodyType: "sedan",
    priceEUR: 37490,
    rangeKm: 450,
    brandOrigin: "china"
  });
  const nio = sampleVehicle({
    id: "nio",
    make: "Nio",
    model: "ET5",
    bodyType: "sedan",
    priceEUR: 55000,
    rangeKm: 500,
    brandOrigin: "china"
  });
  const result = matchVehicles([mg, nio], criteria, 2);
  assert.equal(result.recommendations[0]?.vehicle.id, "nio");
  assert.ok(
    (result.recommendations.find((match) => match.vehicle.id === "nio")?.score ?? 0) >
      (result.recommendations.find((match) => match.vehicle.id === "mg")?.score ?? 0)
  );
});

test("soft browsing language still keeps body soft", () => {
  const criteria = extractCriteria("Looking for an SUV under 50000 EUR");
  assert.ok(criteria.bodyTypes.includes("suv"));
  assert.equal(hasHardBodyTypeConstraint(criteria), false);
  assert.deepEqual(buildHybridSearchFilters(criteria).hardBodyTypes, []);
});
