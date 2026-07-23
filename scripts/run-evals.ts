import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { extractCriteria, needsClarification } from "../lib/criteria.ts";
import { evalScenarios, type EvalScenario } from "../lib/data/eval-scenarios.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import { fallbackRecommendationExplanation } from "../lib/recommendation-explanations.ts";
import {
  calculateNdcgAtK,
  calculateRecallAtK,
  evalTopK,
  explanationIncludesFacts,
  explanationIsGrounded
} from "../lib/recommendation-eval.ts";
import { getHardFilterReasons, matchVehicles } from "../lib/scoring.ts";
import type { MatchResult } from "../lib/types.ts";

export {
  calculateNdcgAtK,
  calculateRecallAtK,
  explanationIsGrounded
} from "../lib/recommendation-eval.ts";

type EvalResult = {
  id: string;
  passed: boolean;
  matches: number;
  recallAtK?: number;
  ndcgAtK?: number;
  constraintViolations: number;
  explanationGrounded?: boolean;
  reason?: string;
};

function evaluateScenario(scenario: EvalScenario): EvalResult {
  const criteria = extractCriteria(scenario.prompt);
  const matchResult = needsClarification(criteria)
    ? { recommendations: [], rejected: [] }
    : matchVehicles(seedVehicles, criteria, evalTopK);
  const returnedIds = matchResult.recommendations.map((match) => match.vehicle.id);
  const constraintViolations = countConstraintViolations(matchResult.recommendations, criteria);
  const matches = matchResult.recommendations.length;
  const recallAtK = scenario.expectedEligibleIds
    ? calculateRecallAtK(returnedIds, scenario.expectedEligibleIds, evalTopK)
    : undefined;
  const ndcgAtK = scenario.acceptableTopKIds
    ? calculateNdcgAtK(returnedIds, scenario.acceptableTopKIds, evalTopK)
    : undefined;
  const explanationGrounded = evaluateExplanationGrounding(
    matchResult.recommendations,
    criteria,
    scenario
  );
  const passed =
    matches >= scenario.expectedMinMatches &&
    constraintViolations === 0 &&
    (recallAtK === undefined || recallAtK === 1) &&
    (ndcgAtK === undefined || ndcgAtK > 0) &&
    (explanationGrounded === undefined || explanationGrounded);

  return {
    id: scenario.id,
    passed,
    matches,
    recallAtK,
    ndcgAtK,
    constraintViolations,
    explanationGrounded,
    reason: passed ? undefined : buildFailureReason({
      scenario,
      matches,
      constraintViolations,
      recallAtK,
      ndcgAtK,
      explanationGrounded,
      returnedIds
    })
  };
}

function countConstraintViolations(recommendations: MatchResult[], criteria: ReturnType<typeof extractCriteria>) {
  return recommendations.filter((match) => getHardFilterReasons(match.vehicle, criteria).length > 0).length;
}

function evaluateExplanationGrounding(
  recommendations: MatchResult[],
  criteria: ReturnType<typeof extractCriteria>,
  scenario: EvalScenario
): boolean | undefined {
  const first = recommendations[0];
  if (!first) return undefined;

  const explanation = fallbackRecommendationExplanation({
    question: "Warum passt dieses Auto?",
    criteria,
    recommendations
  });
  const grounded =
    explanationIsGrounded(explanation, first.vehicle, first.reasonLedger) &&
    (!scenario.requiredExplanationFacts?.length ||
      explanationIncludesFacts(explanation, first.vehicle, scenario.requiredExplanationFacts));

  return grounded;
}

function buildFailureReason(input: {
  scenario: EvalScenario;
  matches: number;
  constraintViolations: number;
  recallAtK?: number;
  ndcgAtK?: number;
  explanationGrounded?: boolean;
  returnedIds: string[];
}) {
  const reasons: string[] = [];
  if (input.matches < input.scenario.expectedMinMatches) {
    reasons.push(
      `expected at least ${input.scenario.expectedMinMatches} matches, got ${input.matches}`
    );
  }
  if (input.constraintViolations > 0) {
    reasons.push(`${input.constraintViolations} hard-constraint violation(s)`);
  }
  if (input.recallAtK !== undefined && input.recallAtK < 1) {
    const missing = input.scenario.expectedEligibleIds?.filter((id) => !input.returnedIds.slice(0, evalTopK).includes(id));
    reasons.push(`Recall@${evalTopK}=${input.recallAtK.toFixed(2)}; missing eligible ids: ${missing?.join(", ") ?? "none"}`);
  }
  if (input.ndcgAtK !== undefined && input.ndcgAtK === 0) {
    reasons.push(`NDCG@${evalTopK}=0; none of ${input.scenario.acceptableTopKIds?.join(", ")} in top ${evalTopK}`);
  }
  if (input.explanationGrounded === false) {
    reasons.push("deterministic explanation is not grounded");
  }
  return reasons.join("; ");
}

function runEvals() {
  const results = evalScenarios.map(evaluateScenario);
  const failed = results.filter((result) => !result.passed);
  const successRate = (results.length - failed.length) / results.length;
  const avgRecall =
    average(results.map((result) => result.recallAtK).filter((value): value is number => value !== undefined)) ??
    null;
  const avgNdcg =
    average(results.map((result) => result.ndcgAtK).filter((value): value is number => value !== undefined)) ?? null;
  const constraintViolations = results.reduce((sum, result) => sum + result.constraintViolations, 0);
  const groundedCount = results.filter((result) => result.explanationGrounded === true).length;
  const groundedTotal = results.filter((result) => result.explanationGrounded !== undefined).length;

  console.table(results);
  console.log(
    [
      `Eval success: ${Math.round(successRate * 100)}% (${results.length - failed.length}/${results.length})`,
      avgRecall === null ? null : `Recall@${evalTopK}: ${avgRecall.toFixed(2)}`,
      avgNdcg === null ? null : `NDCG@${evalTopK}: ${avgNdcg.toFixed(2)}`,
      `Constraint violations: ${constraintViolations}`,
      groundedTotal === 0
        ? null
        : `Explanation factuality: ${groundedCount}/${groundedTotal} grounded`
    ]
      .filter(Boolean)
      .join(" | ")
  );

  assert.equal(failed.length, 0, failed.map((result) => `${result.id}: ${result.reason}`).join("\n"));
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEvals();
}
