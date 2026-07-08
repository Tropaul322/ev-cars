import assert from "node:assert/strict";
import test from "node:test";
import { emptyCriteria, extractCriteria } from "../lib/criteria.ts";
import {
  buildLlmScoringInput,
  LLM_SCORING_CANDIDATE_LIMIT,
  llmScoringEnabled,
  parseLlmScoringJson
} from "../lib/llm-scoring.ts";
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

test("buildLlmScoringInput keeps a compact payload for fast OpenAI scoring", () => {
  const criteria = emptyCriteria("find EV with range");
  const result = matchVehicles(seedVehicles, criteria, 20);
  assert.ok(result.recommendations.length >= 2);

  const input = buildLlmScoringInput(result.recommendations.slice(0, 20), criteria, "find EV with range");
  assert.ok(input.vehicles.length <= LLM_SCORING_CANDIDATE_LIMIT);
  assert.equal("criteria" in input, false);
  assert.equal("scoringBreakdown" in input.vehicles[0], false);
  assert.equal("notes" in input.vehicles[0].vehicle, false);
  assert.equal("reviewTags" in input.vehicles[0].vehicle, false);
  assert.ok(JSON.stringify(input).length < 8000);
});

test("LLM scoring stays off the hot path unless explicitly enabled", () => {
  const previousEnable = process.env.FLOWRYD_ENABLE_LLM_SCORING;
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.FLOWRYD_ENABLE_LLM_SCORING;
  process.env.OPENAI_API_KEY = previousKey || "test-key";

  assert.equal(llmScoringEnabled(), false);

  process.env.FLOWRYD_ENABLE_LLM_SCORING = "1";
  assert.equal(llmScoringEnabled(), true);

  if (previousEnable === undefined) delete process.env.FLOWRYD_ENABLE_LLM_SCORING;
  else process.env.FLOWRYD_ENABLE_LLM_SCORING = previousEnable;
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
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
