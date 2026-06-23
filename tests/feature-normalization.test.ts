import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVehicleFeatures, vehicleHasFeature } from "../lib/feature-normalization.ts";
import { prepareWillhabenVehicleForUpload } from "../lib/inventory/willhaben-payload.ts";
import { extractCriteria } from "../lib/criteria.ts";
import { matchVehicles } from "../lib/scoring.ts";
import type { Vehicle } from "../lib/types.ts";

test("maps AutoScout24-style feature labels to canonical keys", () => {
  const features = normalizeVehicleFeatures([
    "Adaptive Cruise Control",
    "Seat heating",
    "Lane departure warning system",
    "Bluetooth",
    "Cruise control"
  ]);

  assert.ok(features.includes("adaptive_cruise_control"));
  assert.ok(features.includes("heated_seats"));
  assert.ok(features.includes("lane_keeping_assist"));
  assert.ok(features.includes("reliable_connectivity"));
  assert.equal(features.includes("apple_carplay"), false);
});

test("keeps canonical feature keys and infers awd from drivetrain", () => {
  const features = normalizeVehicleFeatures(["apple_carplay", "heated_seats"], {
    drivetrain: "AWD",
    cargoLiters: 520,
    bodyType: "suv"
  });

  assert.deepEqual(features.sort(), ["apple_carplay", "awd", "heated_seats", "large_trunk"].sort());
});

test("vehicleHasFeature matches scraped labels without full normalization pass", () => {
  assert.equal(
    vehicleHasFeature(["Adaptive Cruise Control", "Seat heating"], "heated_seats"),
    true
  );
  assert.equal(vehicleHasFeature(["Cruise control"], "adaptive_cruise_control"), false);
});

test("prepareWillhabenVehicleForUpload normalizes scraped feature labels", () => {
  const vehicle = prepareWillhabenVehicleForUpload({
    id: "autoscout:1",
    source: "autoscout24",
    market: "AT",
    make: "Kia",
    model: "EV6",
    trim: "GT-Line",
    priceEUR: 42900,
    condition: "used",
    bodyType: "suv",
    seats: 5,
    available: true,
    features: ["Adaptive Cruise Control", "Seat heating", "Lane departure warning system", "Bluetooth"],
    images: ["https://example.com/car.jpg"],
    notes: "",
    brandOrigin: "korea",
    reviewTags: []
  } as never);

  assert.ok(vehicle.features.includes("adaptive_cruise_control"));
  assert.ok(vehicle.features.includes("heated_seats"));
  assert.ok(vehicle.features.includes("lane_keeping_assist"));
});

test("scored inventory gets non-zero feature fit for typical listings", () => {
  const vehicle: Vehicle = {
    id: "listing-1",
    source: "autoscout24",
    market: "AT",
    make: "Kia",
    model: "EV6",
    trim: "GT-Line",
    year: 2023,
    condition: "used",
    priceEUR: 42900,
    monthlyLeaseEUR: null,
    mileageKm: 22000,
    rangeKm: 480,
    efficiencyKwhPer100Km: 17,
    batteryKwh: 77,
    batterySoH: 94,
    chargingCycles: null,
    bodyType: "suv",
    seats: 5,
    cargoLiters: 520,
    drivetrain: "AWD",
    powerKw: 168,
    available: true,
    features: normalizeVehicleFeatures([
      "Adaptive Cruise Control",
      "Seat heating",
      "Lane departure warning system",
      "Bluetooth"
    ]),
    images: [],
    notes: "",
    brandOrigin: "korea",
    reviewTags: [],
    warranty: "Used listing",
    location: "Wien"
  };

  const criteria = extractCriteria("Budget 45000 EUR, commute");
  const result = matchVehicles([vehicle], criteria, 1);

  assert.equal(result.recommendations[0]?.scoringBreakdown.featureFit, 75);
  assert.ok((result.recommendations[0]?.score ?? 0) >= 80);
});
