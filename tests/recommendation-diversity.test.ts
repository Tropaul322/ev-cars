import assert from "node:assert/strict";
import test from "node:test";
import { diversifyRecommendations, vehicleBrandKey, vehicleModelKey } from "../lib/recommendation-diversity.ts";
import type { MatchResult, Vehicle } from "../lib/types.ts";

test("diversifyRecommendations spreads brands before repeating a make", () => {
  const matches = [
    fakeMatch("p1", "Polestar", "4", 95),
    fakeMatch("p2", "Polestar", "2", 94),
    fakeMatch("p3", "Polestar", "3", 93),
    fakeMatch("b1", "BMW", "i4", 92),
    fakeMatch("a1", "Audi", "Q4", 91),
    fakeMatch("m1", "Mercedes", "EQA", 90)
  ];

  const selected = diversifyRecommendations(matches, 3, {
    maxPerModel: 2,
    maxPerListing: 1,
    maxPerBrand: 1
  });

  assert.equal(selected.length, 3);
  assert.deepEqual(
    selected.map((match) => match.vehicle.make),
    ["Polestar", "BMW", "Audi"]
  );
});

test("diversifyRecommendations keeps same-brand depth when brand is locked", () => {
  const matches = [
    fakeMatch("p1", "Polestar", "4", 95),
    fakeMatch("p2", "Polestar", "2", 94),
    fakeMatch("p3", "Polestar", "3", 93),
    fakeMatch("b1", "BMW", "i4", 92)
  ];

  const selected = diversifyRecommendations(matches, 3, {
    maxPerModel: 2,
    maxPerListing: 1,
    maxPerBrand: Number.POSITIVE_INFINITY
  });

  assert.equal(selected.length, 3);
  assert.deepEqual(
    selected.map((match) => `${match.vehicle.make} ${match.vehicle.model}`),
    ["Polestar 4", "Polestar 2", "Polestar 3"]
  );
});

test("diversifyRecommendations fills with same brand when pool is thin", () => {
  const matches = [
    fakeMatch("p1", "Polestar", "4", 95),
    fakeMatch("p2", "Polestar", "2", 94),
    fakeMatch("p3", "Polestar", "3", 93)
  ];

  const selected = diversifyRecommendations(matches, 3, {
    maxPerModel: 2,
    maxPerListing: 1,
    maxPerBrand: 1
  });

  assert.equal(selected.length, 3);
  assert.equal(selected[0]?.vehicle.make, "Polestar");
  assert.ok(selected.some((match) => match.vehicle.model === "2"));
});

test("vehicle keys normalize brand and model", () => {
  assert.equal(vehicleBrandKey({ make: " Mercedes-Benz " } as Vehicle), "mercedes benz");
  assert.equal(vehicleModelKey({ make: "BMW", model: "iX 1" } as Vehicle), "bmw ix 1");
});

function fakeMatch(id: string, make: string, model: string, score: number): MatchResult {
  return {
    vehicle: {
      id,
      make,
      model,
      trim: "",
      year: 2024,
      bodyType: "suv",
      priceEUR: 40000,
      monthlyLeaseEUR: null,
      rangeKm: 400,
      batteryKWh: 60,
      efficiencyKWhPer100km: 16,
      drivetrain: "fwd",
      powerKw: 150,
      seats: 5,
      cargoLiters: 400,
      chargingAccessNotes: "",
      features: [],
      availability: "in_stock",
      location: "AT",
      source: "test",
      listingUrl: null,
      notes: "",
      reviewTags: [],
      condition: "used",
      mileageKm: 10000,
      batterySoH: 95,
      market: "AT",
      available: true,
      manufacturerCountry: null,
      brandOrigin: null
    } as Vehicle,
    score,
    ruleScore: score,
    scoreSource: "rules",
    ragScore: 0,
    ragEvidence: [],
    hardFilterStatus: "passed",
    scoringBreakdown: {
      priceFit: score,
      rangeFit: score,
      efficiencyFit: score,
      brandFit: score,
      cargoPassengerFit: score,
      reliabilityFit: score,
      featureFit: score
    },
    scoringWeights: {
      priceFit: 1,
      rangeFit: 0,
      efficiencyFit: 0,
      brandFit: 0,
      cargoPassengerFit: 0,
      reliabilityFit: 0,
      featureFit: 0
    },
    explanation: "",
    ruledOutReasons: [],
    tco: {
      purchasePriceEUR: 40000,
      estimatedMonthlyPaymentEUR: 0,
      fiveYearEnergyEUR: 0,
      fiveYearMaintenanceEUR: 0,
      fiveYearTotalEUR: 40000,
      assumptions: []
    },
    reasonLedger: {
      criteriaSummary: [],
      positiveReasons: [],
      tradeOffs: [],
      hardFiltersPassed: [],
      scoreFactors: [],
      ragEvidenceIds: []
    }
  };
}
