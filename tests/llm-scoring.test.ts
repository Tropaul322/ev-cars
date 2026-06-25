import assert from "node:assert/strict";
import test from "node:test";
import { emptyCriteria, extractCriteria } from "../lib/criteria.ts";
import { parseLlmScoringJson } from "../lib/llm-scoring.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import { buildRagContext } from "../lib/rag.ts";
import { matchVehicles } from "../lib/scoring.ts";

test("extractCriteria infers road trips and good range for american EV query", () => {
  const criteria = extractCriteria(
    "So i need an american car like Ford or Tesla price somewhree 35k EUR with a good range for trips"
  );

  assert.equal(criteria.budgetMaxEUR, 35000);
  assert.deepEqual(criteria.brandPreferences, ["Tesla", "Ford"]);
  assert.ok(criteria.preferredBrandOrigins.includes("us"));
  assert.ok(criteria.tripNeeds.includes("road_trip"));
  assert.equal(criteria.rangeFloorKm, 450);
});

test("parseLlmScoringJson accepts fenced JSON rankings", () => {
  const rankings = parseLlmScoringJson(
    '```json\n{"rankings":[{"vehicleId":"a","score":91,"fitSummary":"Strong range fit"}]}\n```'
  );

  assert.deepEqual(rankings, [
    { vehicleId: "a", score: 91, fitSummary: "Strong range fit" }
  ]);
});

test("semantic keyword blend can outrank a cheaper listing without embeddings", () => {
  const template = seedVehicles.find((vehicle) => vehicle.bodyType === "suv");
  assert.ok(template);

  const cheaper = {
    ...template,
    id: "cheap-generic-suv",
    make: "Generic",
    model: "Budget SUV",
    priceEUR: 22000,
    rangeKm: 320
  };
  const betterFit = {
    ...template,
    id: "road-trip-suv",
    make: "Ford",
    model: "Mustang Mach-E",
    priceEUR: 34000,
    rangeKm: 500,
    notes: "family road trip suv long range autobahn"
  };

  const criteria = {
    ...emptyCriteria("american SUV for road trips under 40000 EUR"),
    budgetMaxEUR: 40000,
    tripNeeds: ["road_trip" as const],
    brandPreferences: ["Ford"]
  };
  const ragContext = buildRagContext({
    message: "american SUV for road trips under 40000 EUR",
    criteria,
    vehicles: [cheaper, betterFit],
    documents: []
  });

  const result = matchVehicles([cheaper, betterFit], criteria, 1, { ragContext });
  assert.equal(result.recommendations[0]?.vehicle.id, "road-trip-suv");
});
