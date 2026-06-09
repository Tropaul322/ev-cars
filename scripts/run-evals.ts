import assert from "node:assert/strict";
import { extractCriteria, needsClarification } from "../lib/criteria.ts";
import { evalScenarios } from "../lib/data/eval-scenarios.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import { matchVehicles } from "../lib/scoring.ts";

type EvalResult = {
  id: string;
  passed: boolean;
  matches: number;
  reason?: string;
};

const results: EvalResult[] = evalScenarios.map((scenario) => {
  const criteria = extractCriteria(scenario.prompt);
  const matchResult = needsClarification(criteria)
    ? { recommendations: [], rejected: [] }
    : matchVehicles(seedVehicles, criteria);
  const matches = matchResult.recommendations.length;
  const passed = matches >= scenario.expectedMinMatches;

  return {
    id: scenario.id,
    passed,
    matches,
    reason: passed
      ? undefined
      : `expected at least ${scenario.expectedMinMatches} matches, got ${matches}`
  };
});

const failed = results.filter((result) => !result.passed);
const successRate = (results.length - failed.length) / results.length;

console.table(results);
console.log(`Eval success: ${Math.round(successRate * 100)}% (${results.length - failed.length}/${results.length})`);

assert.equal(failed.length, 0, failed.map((result) => `${result.id}: ${result.reason}`).join("\n"));
