import test from "node:test";
import assert from "node:assert/strict";
import { emptyCriteria } from "../lib/criteria.ts";
import {
  buildScoringBreakdownRows,
  computeWeightedRuleScore,
  describeScoringWeightAdjustments,
} from "../lib/scoring-breakdown-display.ts";
import { matchVehicles } from "../lib/scoring.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";

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
