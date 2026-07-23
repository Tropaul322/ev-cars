import assert from "node:assert/strict";
import test from "node:test";
import type { Vehicle } from "../lib/types.ts";
import {
  calculateNdcgAtK,
  calculateRecallAtK,
  explanationIsGrounded
} from "../scripts/run-evals.ts";

const vehicleWith400KmRange: Vehicle = {
  id: "test-ev",
  source: "seed",
  market: "AT",
  make: "Test",
  model: "EV",
  trim: "Base",
  year: 2024,
  priceEUR: 35000,
  monthlyLeaseEUR: 400,
  condition: "new",
  mileageKm: null,
  rangeKm: 400,
  efficiencyKwhPer100Km: 16,
  batteryKwh: 60,
  batterySoH: null,
  chargingCycles: null,
  warranty: "Standard",
  bodyType: "hatchback",
  seats: 5,
  cargoLiters: 350,
  drivetrain: "RWD",
  powerKw: 150,
  available: true,
  features: [],
  images: [],
  notes: "",
  brandOrigin: "europe",
  reviewTags: []
};

test("ranking metrics reward a relevant first result", () => {
  assert.equal(calculateRecallAtK(["a", "b"], ["a", "c"], 2), 0.5);
  assert.ok(calculateNdcgAtK(["a", "b"], ["a"], 2) > calculateNdcgAtK(["b", "a"], ["a"], 2));
});

test("grounding check rejects missing explanation facts", () => {
  assert.equal(explanationIsGrounded("This has 900 km range", vehicleWith400KmRange), false);
});
