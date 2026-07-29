import test from "node:test";
import assert from "node:assert/strict";
import { emptyCriteria } from "../lib/criteria.ts";
import {
  buildScoringBreakdownRows,
  computeWeightedRuleScore,
  describeScoringWeightAdjustments,
  formatMatchScoreEquation,
} from "../lib/scoring-breakdown-display.ts";
import { matchVehicles } from "../lib/scoring.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import type { Vehicle } from "../lib/types.ts";

test("buildScoringBreakdownRows exposes factor, weight, and contribution", () => {
  const criteria = {
    ...emptyCriteria("Budget 40000 EUR SUV best value", "en"),
    budgetMaxEUR: 40000,
    bodyTypes: ["suv" as const],
    optimizationDirective: "best_value" as const,
  };
  const { recommendations } = matchVehicles(seedVehicles, criteria, 1);
  const match = recommendations[0];
  assert.ok(match);

  const rows = buildScoringBreakdownRows(match);
  assert.equal(rows.length, 7);
  const priceRow = rows.find((row) => row.key === "priceFit");
  assert.ok(priceRow);
  assert.ok(priceRow.weightPct > priceRow.baseWeightPct);

  const weighted = computeWeightedRuleScore(match.scoringBreakdown, match.scoringWeights);
  assert.ok(Math.abs(weighted - (match.ruleScore ?? match.score)) <= 2);
});

test("ruleScore stays the weighted factor average when semantic blend raises displayed score", () => {
  const template = seedVehicles.find((vehicle) => vehicle.bodyType === "suv");
  assert.ok(template);

  const vehicle: Vehicle = {
    ...template,
    id: "semantic-boosted-suv",
    priceEUR: 32000,
    rangeKm: 450,
    embeddingSimilarity: 0.82,
  };
  const criteria = {
    ...emptyCriteria("family SUV under 40000 EUR with good range", "en"),
    budgetMaxEUR: 40000,
    bodyTypes: ["suv" as const],
    rangeFloorKm: 300,
  };

  const { recommendations } = matchVehicles([vehicle], criteria, 1);
  const match = recommendations[0];
  assert.ok(match);

  const weighted = computeWeightedRuleScore(match.scoringBreakdown, match.scoringWeights);
  assert.equal(match.ruleScore, weighted);
  assert.ok(match.score > weighted, "semantic blend should raise displayed match % above rule score");
  assert.ok(match.semanticBoost);
  assert.equal(match.semanticBoost.totalPoints, match.score - weighted);
  assert.ok(match.semanticBoost.boostScale > 0);
  assert.ok(match.semanticBoost.blendStrength > 0);
  assert.ok(match.semanticBoost.components.length > 0);
  assert.ok(
    match.semanticBoost.components.every(
      (component) => component.points > 0 && component.label.length > 0 && component.detail.length > 0
    )
  );
  const componentSum = match.semanticBoost.components.reduce((sum, component) => sum + component.points, 0);
  assert.equal(componentSum, match.semanticBoost.totalPoints);
});

test("formatMatchScoreEquation shows rule + wording boost math", () => {
  assert.equal(
    formatMatchScoreEquation(85, 96, { totalPoints: 11, blendStrength: 0.61, boostScale: 18 }),
    "85 + round(61% wording fit × 18 max) = 96%"
  );
  assert.equal(formatMatchScoreEquation(85, 85), "85% match = weighted rule score (no wording boost)");
});

test("describeScoringWeightAdjustments lists active priority shifts", () => {
  const notes = describeScoringWeightAdjustments({
    ...emptyCriteria("freedom and best value", "en"),
    optimizationDirective: "best_value",
    personalWish: "freedom",
    preferredBrandOrigins: ["china"],
  });
  assert.ok(notes.some((note) => note.includes("best value")));
  assert.ok(notes.some((note) => note.includes("freedom")));
  assert.ok(notes.some((note) => note.includes("brand origin")));
});
