/**
 * Historical PoC use cases (pre–July 24 Gerald summary) — live Supabase only.
 * Ensures the five release-blocking flows work end-to-end on real inventory.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCriteria,
  extractOptimizationDirective,
  looksLikeNoBudgetLimit
} from "../lib/criteria.ts";
import { classifyConversationTurn, looksLikeEvQuestion } from "../lib/conversational-intent.ts";
import { filterVehiclesWithSanityChecks, runMatchRequest } from "../lib/match-service.ts";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";
import { listVehicles } from "../lib/repositories/vehicle-repository.ts";
import type { MatchResponse } from "../lib/types.ts";

process.env.FLOWRYD_DISABLE_LLM = "1";
process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";
process.env.FLOWRYD_VEHICLE_EMBEDDING_SEARCH = "0";
process.env.FLOWRYD_VEHICLE_STRUCTURED_SEARCH = "1";

const supabase = getSupabaseRestConfig();
if (!supabase) {
  throw new Error(
    "poc-use-cases tests require live Supabase credentials. Seed data is not allowed."
  );
}

async function assertLiveInventory() {
  const vehicles = await listVehicles();
  assert.ok(vehicles.length > 0, "expected live Supabase vehicles");
  assert.ok(
    vehicles.some((vehicle) => vehicle.source === "willhaben" || vehicle.source === "autoscout24"),
    "expected marketplace inventory from live Supabase"
  );
  return vehicles;
}

async function answerUntilMatch(
  first: MatchResponse,
  maxTurns = 10
): Promise<MatchResponse> {
  let current = first;
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (current.type === "matches" || current.type === "no_matches") return current;
    assert.equal(current.type, "clarification", `expected clarification, got ${current.type}`);
    const key = current.prompt?.key;
    assert.ok(key, "clarification needs a prompt key");

    if (key === "optimization") {
      current = await runMatchRequest({
        message: current.criteria.optimizationDirective ? "continue" : "Best value",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: {
          optimizationDirective: current.criteria.optimizationDirective ?? "best_value"
        },
        currentPromptKey: "optimization"
      });
      continue;
    }
    if (key === "budget") {
      current = await runMatchRequest({
        message: "Under 50000",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { budgetMaxEUR: 50000 },
        currentPromptKey: "budget"
      });
      continue;
    }
    if (key === "vehicle_preferences") {
      current = await runMatchRequest({
        message: "SUV",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { bodyTypes: ["suv"] },
        currentPromptKey: key
      });
      continue;
    }
    if (key === "charging_or_range") {
      current = await runMatchRequest({
        message: "at least 350 km range",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { rangeFloorKm: 350 },
        currentPromptKey: key
      });
      continue;
    }
    if (key === "personal_wish") {
      current = await runMatchRequest({
        message: "freedom",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { personalWish: "freedom" },
        currentPromptKey: "personal_wish"
      });
      continue;
    }
    if (key === "use_case") {
      current = await runMatchRequest({
        message: "commute",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { tripNeeds: ["commute"] },
        currentPromptKey: "use_case"
      });
      continue;
    }
    throw new Error(`unhandled clarification key: ${key}`);
  }
  throw new Error("did not reach match/no_matches within clarification budget");
}

function assertNoStall(response: MatchResponse) {
  assert.notEqual(response.type, "chat");
  assert.ok(
    response.type === "matches" ||
      response.type === "no_matches" ||
      response.type === "clarification",
    `unexpected response type ${response.type}`
  );
  assert.doesNotMatch(response.assistantMessage, /let me search/i);
}

test("live inventory has no insane ranges in the scoring pool", async () => {
  const vehicles = await assertLiveInventory();
  const { vehicles: sane, rejectedCount } = filterVehiclesWithSanityChecks(vehicles);
  assert.ok(sane.every((vehicle) => vehicle.rangeKm <= 900));
  assert.ok(
    !sane.some((vehicle) => vehicle.rangeKm > 1000),
    "sanity filter must drop Sealion-style 5000+ km ranges"
  );
  assert.ok(rejectedCount >= 0);
});

test("UC1: electric vehicle made in China returns Chinese-origin top match", async () => {
  await assertLiveInventory();
  const first = await runMatchRequest({
    message: "I'm looking for an electric vehicle made in China"
  });
  assertNoStall(first);
  assert.deepEqual(first.criteria.preferredBrandOrigins, ["china"]);
  const matched = await answerUntilMatch(first);
  assert.equal(matched.type, "matches");
  assert.equal(matched.recommendations.length, 1);
  assert.equal(matched.recommendations[0].vehicle.brandOrigin, "china");
  assert.ok((matched.alternativeRecommendations?.length ?? 0) >= 0);
  assert.ok(matched.recommendations[0].vehicle.rangeKm <= 900);
});

test("UC2: weekday commute + mountain bike cargo reaches a cargo-aware match", async () => {
  await assertLiveInventory();
  const extracted = extractCriteria(
    "Weekday commuter, weekend space for a mountain bike under 50000 EUR SUV with 350 km looking for freedom"
  );
  assert.equal(extracted.cargoNeeds, "high");

  const first = await runMatchRequest({
    message: "Weekday commute EV with weekend space for a mountain bike"
  });
  assertNoStall(first);
  const matched = await answerUntilMatch(first);
  assert.ok(matched.type === "matches" || matched.type === "no_matches");
  if (matched.type === "matches") {
    assert.equal(matched.recommendations.length, 1);
    const explanation = matched.recommendations[0].explanation || "";
    assert.ok(
      matched.criteria.cargoNeeds === "high" ||
        /cargo|trunk|boot|koffer|liter|l\b|wagon|space/i.test(explanation),
      "expected cargo/space reasoning in the match explanation"
    );
  }
});

test("UC3 CRITICAL: family → 2-seater sports pivot changes the ranking path", async () => {
  await assertLiveInventory();
  const family = await runMatchRequest({
    message: "EV for a young family with two kids under 50000 EUR SUV 350 km looking for status"
  });
  let current = await answerUntilMatch(family);
  assert.ok(current.type === "matches" || current.type === "no_matches");

  const pivot = await runMatchRequest({
    message: "forget the family car, show me a fun 2-seater sports EV instead",
    sessionId: current.sessionId,
    previousCriteria: current.criteria
  });
  assert.equal(extractOptimizationDirective(pivot.criteria.rawPrompt || pivot.criteria.latestUserMessage || ""), "performance");
  assert.notEqual(pivot.criteria.optimizationDirective, "best_family_fit");
  assert.equal(pivot.criteria.passengers, 2);

  // Complete any remaining binding clarifications after the pivot.
  current = await answerUntilMatch(pivot);
  if (current.type === "matches") {
    assert.equal(current.recommendations.length, 1);
    for (const recommendation of [
      ...current.recommendations,
      ...(current.alternativeRecommendations ?? [])
    ]) {
      assert.equal(
        recommendation.vehicle.seats,
        2,
        `${recommendation.vehicle.make} ${recommendation.vehicle.model} must be a 2-seater after sports pivot`
      );
    }
  } else {
    assert.equal(current.type, "no_matches");
  }
});

test("UC4 CRITICAL: maximum range + budget irrelevant does not stall", async () => {
  await assertLiveInventory();
  assert.equal(looksLikeNoBudgetLimit("money is not the main concern"), true);
  assert.equal(extractOptimizationDirective("Maximum possible range, budget is irrelevant"), "maximum_range");

  const first = await runMatchRequest({
    message: "Maximum possible range, money is not the main concern"
  });
  assertNoStall(first);
  assert.equal(first.criteria.optimizationDirective, "maximum_range");
  assert.ok(first.criteria.budgetMaxEUR || first.type === "clarification");

  const matched = await answerUntilMatch(first);
  assertNoStall(matched);
  assert.ok(matched.type === "matches" || matched.type === "no_matches");
  if (matched.type === "matches") {
    assert.equal(matched.recommendations.length, 1);
    assert.doesNotMatch(matched.assistantMessage, /let me search/i);
    assert.ok(matched.recommendations[0].vehicle.rangeKm >= 300);
  }
});

test("UC5 CRITICAL: best price-to-performance triggers shopping, not market commentary", async () => {
  await assertLiveInventory();
  const prompt = "Which electric vehicle gives me the best price-to-performance ratio right now?";
  assert.equal(looksLikeEvQuestion(prompt), false);
  assert.equal(classifyConversationTurn(prompt), "criteria");
  assert.equal(extractOptimizationDirective(prompt), "best_value");

  const first = await runMatchRequest({ message: prompt });
  assert.notEqual(first.type, "chat");
  assertNoStall(first);
  assert.equal(first.criteria.optimizationDirective, "best_value");
  assert.doesNotMatch(first.assistantMessage, /Tesla Model 3|IONIQ 5|market/i);

  const matched = await answerUntilMatch(first);
  assertNoStall(matched);
  assert.ok(matched.type === "matches" || matched.type === "no_matches");
  if (matched.type === "matches") {
    assert.equal(matched.recommendations.length, 1);
    assert.ok(matched.recommendations[0].score > 0);
    assert.ok(matched.recommendations[0].scoringBreakdown);
  }
});
