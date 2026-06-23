import assert from "node:assert/strict";
import test from "node:test";
import { emptyCriteria } from "../lib/criteria.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import { blendSemanticSignals } from "../lib/semantic-scoring.ts";
import { matchVehicles } from "../lib/scoring.ts";
import type { Vehicle } from "../lib/types.ts";

test("blendSemanticSignals weights embedding similarity when present", () => {
  const withoutEmbedding = blendSemanticSignals({ keywordScore: 0.2, topicScore: 0.1 });
  const withEmbedding = blendSemanticSignals({
    keywordScore: 0.2,
    topicScore: 0.1,
    embeddingScore: 0.8
  });

  assert.ok(withEmbedding > withoutEmbedding);
});

test("embedding similarity can outrank a cheaper but less relevant listing", () => {
  const template = seedVehicles.find((vehicle) => vehicle.bodyType === "suv");
  assert.ok(template);

  const cheaper: Vehicle = {
    ...template,
    id: "cheap-generic-suv",
    make: "Generic",
    model: "Budget SUV",
    priceEUR: 22000,
    rangeKm: 320
  };
  const semanticMatch: Vehicle = {
    ...template,
    id: "semantic-family-suv",
    make: "Skoda",
    model: "Enyaq",
    priceEUR: 32000,
    rangeKm: 480,
    embeddingSimilarity: 0.78
  };

  const criteria = {
    ...emptyCriteria("family SUV for Vienna with good range under 40000 EUR"),
    budgetMaxEUR: 40000,
    rangeFloorKm: 300,
    bodyTypes: ["suv" as const]
  };

  const result = matchVehicles([cheaper, semanticMatch], criteria, 1);
  assert.equal(result.recommendations[0]?.vehicle.id, "semantic-family-suv");
});

test("diversified ranking prefers distinct models when scores are close", () => {
  const template = seedVehicles[0];
  const vehicles: Vehicle[] = [
    { ...template, id: "a1", make: "Tesla", model: "Model Y", priceEUR: 30000, embeddingSimilarity: 0.7 },
    { ...template, id: "a2", make: "Tesla", model: "Model Y", priceEUR: 30500, embeddingSimilarity: 0.69 },
    { ...template, id: "b1", make: "Skoda", model: "Enyaq", priceEUR: 29800, embeddingSimilarity: 0.68 }
  ];

  const criteria = {
    ...emptyCriteria("family SUV under 40000 EUR"),
    budgetMaxEUR: 40000
  };

  const result = matchVehicles(vehicles, criteria, 3);
  const ids = result.recommendations.map((match) => match.vehicle.id);
  assert.ok(ids.includes("b1"));
});
