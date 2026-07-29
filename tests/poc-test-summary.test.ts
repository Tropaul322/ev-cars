/**
 * PoC New Prototype Version — Test Summary (Gerald, July 24, 2026)
 * + Matching Algorithm v2 regressions that those live tests still fail.
 *
 * These tests MUST run against live Supabase inventory — never seed fallback.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { fallbackMatchIntroMessage } from "../lib/assistant-messages.ts";
import { getClarificationPrompt, nextClarificationPrompt } from "../lib/clarification-catalog.ts";
import {
  emptyCriteria,
  extractCriteria,
  getCriteriaReadiness,
  getMissingCriteria
} from "../lib/criteria.ts";
import { formatMatchInventoryLabel, formatSeeMatchesLabel } from "../lib/match-copy.ts";
import { resolveBuyNowAction } from "../lib/buy-now.ts";
import {
  runMatchRequest,
  shouldAskLowConfidencePriorityQuestion
} from "../lib/match-service.ts";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";
import { listVehicles, searchVehicles } from "../lib/repositories/vehicle-repository.ts";
import { deriveWeights, matchVehicles } from "../lib/scoring.ts";
import type { MatchResult, UserCriteria } from "../lib/types.ts";

process.env.FLOWRYD_DISABLE_LLM = "1";
process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";
process.env.FLOWRYD_VEHICLE_EMBEDDING_SEARCH = "0";
process.env.FLOWRYD_VEHICLE_STRUCTURED_SEARCH = "1";

const supabase = getSupabaseRestConfig();
if (!supabase) {
  throw new Error(
    "poc-test-summary tests require live Supabase credentials (SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL + service/anon key). Seed data is not allowed."
  );
}

async function assertLiveInventory() {
  const vehicles = await listVehicles();
  assert.ok(vehicles.length > 0, "expected live Supabase vehicles");
  assert.ok(
    vehicles.some((vehicle) => vehicle.source === "willhaben" || vehicle.source === "autoscout24"),
    "expected marketplace inventory from live Supabase (not local bundled-only catalog)"
  );
  return vehicles;
}

async function answerUntilMatch(
  first: Awaited<ReturnType<typeof runMatchRequest>>,
  maxTurns = 8
): Promise<Awaited<ReturnType<typeof runMatchRequest>>> {
  let current = first;
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if (current.type === "matches" || current.type === "no_matches") return current;
    assert.equal(current.type, "clarification");
    const key = current.prompt?.key;
    assert.ok(key, "clarification response needs a prompt key");

    if (key === "optimization") {
      current = await runMatchRequest({
        message: "Best value",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { optimizationDirective: "best_value" },
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
        message: "at least 400 km range",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { rangeFloorKm: 400 },
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
        message: "family",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { tripNeeds: ["family"] },
        currentPromptKey: "use_case"
      });
      continue;
    }

    throw new Error(`unhandled clarification key: ${key}`);
  }
  throw new Error("did not reach match/no_matches within clarification budget");
}

test("live Supabase inventory is available (not seed)", async () => {
  const vehicles = await assertLiveInventory();
  assert.ok(vehicles.some((vehicle) => vehicle.brandOrigin === "china"));
});

test("CRITICAL: origin + budget alone is not enough to match", async () => {
  await assertLiveInventory();
  const data = await runMatchRequest({
    message: "I want an electric vehicle from a new Chinese brand under 40000 EUR."
  });

  assert.notEqual(data.type, "matches");
  assert.equal(data.type, "clarification");
  assert.deepEqual(data.criteria.preferredBrandOrigins, ["china"]);
  assert.ok(data.criteria.budgetMaxEUR === 40000 || data.criteria.budgetMaxEUR === 40000);

  const readiness = getCriteriaReadiness(data.criteria);
  assert.equal(readiness.readyToMatch, false);
  assert.ok(getMissingCriteria(data.criteria).length >= 2);
  assert.ok(
    getMissingCriteria(data.criteria).some((key) =>
      ["body_type", "vehicle_preferences", "range", "charging_or_range", "personal_wish"].includes(key)
    )
  );
});

test("binding minimum criteria require budget, body type, range, and personal wish", () => {
  const incomplete: UserCriteria = {
    ...emptyCriteria("Chinese EV under 40k", "en"),
    budgetMaxEUR: 40000,
    preferredBrandOrigins: ["china"]
  };
  assert.equal(getCriteriaReadiness(incomplete).readyToMatch, false);

  const almost: UserCriteria = {
    ...incomplete,
    bodyTypes: ["suv"],
    rangeFloorKm: 400
  };
  assert.equal(getCriteriaReadiness(almost).readyToMatch, false);
  assert.ok(getMissingCriteria(almost).includes("personal_wish"));

  const complete: UserCriteria = {
    ...almost,
    personalWish: "status"
  };
  assert.equal(getCriteriaReadiness(complete).readyToMatch, true);
  assert.deepEqual(getMissingCriteria(complete), []);
});

test("personal wish clarification offers status and freedom", () => {
  const prompt = getClarificationPrompt("personal_wish", "en");
  assert.equal(prompt.key, "personal_wish");
  const ids = prompt.options.map((option) => option.id);
  assert.deepEqual(ids, ["wish_status", "wish_freedom"]);
  assert.ok(prompt.options.every((option) => !option.skip));
});

test("BUG: match intro is singular when only one recommendation is visible", () => {
  const message = fallbackMatchIntroMessage(emptyCriteria("x", "en"), 1, null, ["Leapmotor"]);
  assert.match(message, /strong match|one matching|a matching/i);
  assert.doesNotMatch(message, /found \d+ matching EVs/i);
  assert.doesNotMatch(message, /Found 3/i);

  // Timeout / fallback selection may hold up to 3 cached recommendations but
  // must announce only the visible count (1).
  const timeoutFallbackMessage = fallbackMatchIntroMessage(
    emptyCriteria("x", "en"),
    Math.min(3, 1),
    null,
    ["BYD", "Leapmotor", "MG"]
  );
  assert.doesNotMatch(timeoutFallbackMessage, /Found 3|found 3 matching/i);
  assert.match(timeoutFallbackMessage, /strong match|one matching|a matching/i);
});

test("BUG: match intro must not stitch a priority follow-up question", () => {
  const question = "Should I prioritize lower mileage, longer range, or premium comfort?";
  const message = fallbackMatchIntroMessage(emptyCriteria("x", "en"), 1, question, ["BYD"]);
  assert.doesNotMatch(message, /prioritize lower mileage/i);
  assert.doesNotMatch(message, /\?$/);
});

test("BUG: low-confidence priority question is not asked on match responses", () => {
  const criteria = {
    ...emptyCriteria("Chinese under 40k", "en"),
    budgetMaxEUR: 40000,
    preferredBrandOrigins: ["china" as const]
  };
  assert.equal(
    shouldAskLowConfidencePriorityQuestion(0.4, criteria, getMissingCriteria(criteria)),
    false
  );
});

test("live Chinese-brand search returns Chinese-origin vehicles after full criteria", async () => {
  await assertLiveInventory();
  const first = await runMatchRequest({
    message:
      "Only Chinese brand SUV under 50000 EUR, at least 350 km range, public charging — looking for freedom on the road."
  });
  const data = await answerUntilMatch(first);

  assert.equal(data.type, "matches");
  assert.equal(data.recommendations.length, 1, "UI shows exactly one best match");
  assert.ok(data.alternativeRecommendations?.length ?? 0 >= 0);
  for (const recommendation of data.recommendations) {
    assert.equal(recommendation.vehicle.brandOrigin, "china");
  }
  assert.doesNotMatch(data.assistantMessage, /Found \d+ matching EVs/i);
  assert.doesNotMatch(data.assistantMessage, /prioritize lower mileage|premium comfort\?/i);
  assert.equal(data.criteria.personalWish, "freedom");
});

test("OPEN: final match % is a transparent weighted average of the 7 factors", async () => {
  const vehicles = await assertLiveInventory();
  const criteria: UserCriteria = {
    ...emptyCriteria("value SUV under 60000 with 400 km", "en"),
    budgetMaxEUR: 60000,
    bodyTypes: ["suv"],
    rangeFloorKm: 400,
    personalWish: "status",
    optimizationDirective: "best_value"
  };
  const { recommendations } = matchVehicles(vehicles, criteria, 3);
  assert.ok(recommendations.length > 0);
  const match = recommendations[0] as MatchResult & {
    scoringWeights?: Record<string, number>;
  };
  assert.ok(match.scoringWeights, "recommendations expose scoring weights");
  const weights = match.scoringWeights!;
  const expected = Math.round(
    Object.entries(match.scoringBreakdown).reduce((sum, [key, value]) => {
      return sum + value * (weights[key] ?? 0);
    }, 0)
  );
  // Semantic blend can adjust the displayed score; ruleScore should track the weighted average.
  const ruleScore = match.ruleScore ?? match.score;
  assert.ok(Math.abs(ruleScore - expected) <= 2);

  const derived = deriveWeights(criteria, vehicles);
  assert.ok(derived.priceFit > derived.rangeFit || derived.priceFit >= 0.2);
});

test("wording: listing copy is renamed to matching", () => {
  assert.equal(formatMatchInventoryLabel(1, 1), "1 model • matching found");
  assert.equal(formatMatchInventoryLabel(2, 3), "2 models • matching found");
  assert.equal(formatSeeMatchesLabel(1), "See 1 matching");
  assert.equal(formatSeeMatchesLabel(2), "See 2 matching");
});

test("TO DO: Buy now stays active and opens the purchase target when registered", () => {
  const registered = resolveBuyNowAction({
    registered: true,
    listingUrl: "https://example.com/car/1",
    carPagePath: "/car/abc"
  });
  assert.equal(registered.kind, "open_url");
  assert.equal(registered.href, "https://example.com/car/1");

  const registeredInternal = resolveBuyNowAction({
    registered: true,
    listingUrl: undefined,
    carPagePath: "/car/abc"
  });
  assert.equal(registeredInternal.kind, "open_url");
  assert.equal(registeredInternal.href, "/car/abc");

  const guest = resolveBuyNowAction({
    registered: false,
    listingUrl: "https://example.com/car/1",
    carPagePath: "/car/abc"
  });
  assert.equal(guest.kind, "require_registration");
});

test("live hybrid/structured search does not silently fall back to bundled seed catalog", async () => {
  const { allVehicles } = await import("../lib/data/all-vehicles.ts");
  const bundledIds = new Set(allVehicles.map((vehicle) => vehicle.id));
  const listed = await assertLiveInventory();
  const listedIds = new Set(listed.map((vehicle) => vehicle.id));
  // Live list must not be identical to the local bundled catalog.
  assert.notEqual(listed.length, allVehicles.length);
  assert.ok(
    listed.some((vehicle) => !bundledIds.has(vehicle.id)),
    "live listVehicles() must include marketplace rows absent from bundled seed"
  );

  const criteria = extractCriteria(
    "Chinese brand EV under 50000 EUR SUV with 400 km range looking for freedom"
  );
  criteria.personalWish = "freedom";
  const results = await searchVehicles(criteria, criteria.rawPrompt);
  assert.ok(results.length > 0);
  // Live hybrid may include rows whose `source` column is still "seed" from earlier uploads.
  // What must not happen is a silent fallback to the local bundled catalog when Supabase is up.
  const liveHits = results.filter(
    (vehicle) =>
      vehicle.source === "willhaben" ||
      vehicle.source === "autoscout24" ||
      listedIds.has(vehicle.id) ||
      !bundledIds.has(vehicle.id)
  );
  assert.ok(
    liveHits.length > 0,
    "expected live Supabase inventory hits, not local bundled-only results"
  );
  assert.ok(
    results.some((vehicle) => vehicle.source === "willhaben" || vehicle.source === "autoscout24"),
    "expected at least one marketplace-sourced vehicle from live Supabase"
  );
});

test("decline answers advance instead of re-asking the same clarification", async () => {
  await assertLiveInventory();
  let current = await runMatchRequest({
    message: "Chinese brand EV under 40000"
  });
  assert.equal(current.type, "clarification");

  if (current.prompt?.key === "budget") {
    current = await runMatchRequest({
      message: "Under 40000",
      sessionId: current.sessionId,
      previousCriteria: current.criteria,
      criteriaPatch: { budgetMaxEUR: 40000 },
      currentPromptKey: "budget"
    });
  }
  assert.equal(current.type, "clarification");
  assert.equal(current.prompt?.key, "vehicle_preferences");

  const declined = await runMatchRequest({
    message: "No",
    sessionId: current.sessionId,
    previousCriteria: current.criteria,
    currentPromptKey: "vehicle_preferences"
  });
  // "No" marks no specific body/features/brands/cargo and advances to the next question.
  assert.equal(declined.type, "clarification");
  assert.notEqual(declined.prompt?.key, "vehicle_preferences");
  assert.ok(declined.criteria.bodyTypes.length > 0);
  assert.deepEqual(declined.criteria.mustHaveFeatures, []);
  assert.deepEqual(declined.criteria.brandPreferences, []);
  assert.equal(declined.criteria.cargoNeeds, null);
  assert.equal(declined.criteria.passengers, null);
  assert.doesNotMatch(declined.assistantMessage, /no rush|pick an option below/i);
});

test("soft brand-origin preference ranks matching origins above others", async () => {
  const vehicles = await assertLiveInventory();
  const criteria: UserCriteria = {
    ...emptyCriteria("Chinese brand SUV under 50000 with 350 km freedom", "en"),
    budgetMaxEUR: 50000,
    bodyTypes: ["suv"],
    rangeFloorKm: 350,
    personalWish: "freedom",
    preferredBrandOrigins: ["china"]
  };
  const { recommendations } = matchVehicles(vehicles, criteria, 5);
  assert.ok(recommendations.length > 0);
  assert.equal(recommendations[0].vehicle.brandOrigin, "china");
  assert.equal(recommendations[0].scoringBreakdown.brandFit, 100);
  const nonChina = recommendations.find((match) => match.vehicle.brandOrigin !== "china");
  if (nonChina) {
    assert.equal(nonChina.scoringBreakdown.brandFit, 52);
    assert.ok(recommendations[0].score >= nonChina.score);
  }
});

test("next clarification after budget+origin asks for body/range/wish — not ready", () => {
  const criteria: UserCriteria = {
    ...emptyCriteria("Chinese under 40k", "en"),
    budgetMaxEUR: 40000,
    preferredBrandOrigins: ["china"]
  };
  const prompt = nextClarificationPrompt(criteria, []);
  assert.notEqual(prompt.key, "ready");
  assert.notEqual(prompt.key, "optimization");
});
