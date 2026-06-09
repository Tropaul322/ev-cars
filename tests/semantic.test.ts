import assert from "node:assert/strict";
import test from "node:test";
import { extractCriteria } from "../lib/criteria.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import {
  blendSemanticSignals,
  computeTopicAffinity,
  scoreVehicleTopicAffinity
} from "../lib/semantic-scoring.ts";
import { buildRagContext } from "../lib/rag.ts";

test("computeTopicAffinity weights retrieved knowledge topics", () => {
  const affinity = computeTopicAffinity([
    { topic: "charging_network", score: 0.8 },
    { topic: "review", score: 0.4 }
  ]);

  assert.ok((affinity.charging_network ?? 0) > (affinity.review ?? 0));
  assert.ok(Math.abs(Object.values(affinity).reduce((sum, value) => sum + value, 0) - 1) < 0.01);
});

test("scoreVehicleTopicAffinity boosts public-charging fit vehicles", () => {
  const criteria = extractCriteria("Budget 40000 EUR, apartment without wallbox, public charging.");
  const affinity = { charging_network: 0.7, review: 0.3 };
  const longRange = seedVehicles.find((vehicle) => vehicle.rangeKm >= 420);
  const shortRange = seedVehicles.find((vehicle) => vehicle.rangeKm < 350);
  assert.ok(longRange);
  assert.ok(shortRange);

  assert.ok(
    scoreVehicleTopicAffinity(longRange, criteria, affinity) >
      scoreVehicleTopicAffinity(shortRange, criteria, affinity)
  );
});

test("blendSemanticSignals prefers embedding scores when present", () => {
  const withoutEmbedding = blendSemanticSignals({ keywordScore: 0.4, embeddingScore: 0, topicScore: 0.2 });
  const withEmbedding = blendSemanticSignals({ keywordScore: 0.4, embeddingScore: 0.9, topicScore: 0.2 });
  assert.ok(withEmbedding > withoutEmbedding);
});

test("buildRagContext exposes embedding and topic affinity fields", () => {
  const criteria = extractCriteria("Premium EV with public charging guidance under 45000 EUR.");
  const ragContext = buildRagContext({
    message: criteria.rawPrompt,
    criteria,
    vehicles: seedVehicles.slice(0, 5),
    documents: [
      {
        id: "chunk:review",
        source: "test",
        heading: "Premium comfort review",
        content: "Premium road trip comfort and refined cabin quality.",
        topic: "review",
        similarity: 0.82,
        payload: {}
      }
    ],
    embeddedVehicleMatches: [
      {
        vehicle: seedVehicles[0]!,
        similarity: 0.76
      }
    ]
  });

  assert.ok(Object.keys(ragContext.topicAffinity).length > 0);
  assert.ok(ragContext.vehicleEmbeddingScores[seedVehicles[0]!.id] > 0);
});
