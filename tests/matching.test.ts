import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getClarificationPrompt } from "../lib/clarification-catalog.ts";
import { resolveClarificationAnswer } from "../lib/clarification-resolver.ts";
import { detectLanguage, emptyCriteria, extractCriteria, languageLabel, languageReplyInstruction, needsClarification, removeCriteriaKey } from "../lib/criteria.ts";
import { applyChipPatch, applyCriteriaPatch, normalizeCriteria } from "../lib/criteria-normalizer.ts";
import type { MissingCriteria } from "../lib/types.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import { parseLlmExplanationJson } from "../lib/explanations.ts";
import { runMatchRequest } from "../lib/match-service.ts";
import { buildRagContext } from "../lib/rag.ts";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";
import { getHardFilterReasons, matchVehicles, scorePrice, scoreVehicle } from "../lib/scoring.ts";
import { calculateTco } from "../lib/tco.ts";

for (const [key, value] of Object.entries(loadEnv(path.join(process.cwd(), ".env.local")))) {
  if (typeof value === "string") process.env[key] = value;
}

process.env.FLOWRYD_DISABLE_LLM = "1";
process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";

const hasSupabaseInventory = Boolean(getSupabaseRestConfig());
const matchRoute = hasSupabaseInventory ? test : test.skip;

test("extracts German budget, charging access, range, and features", () => {
  const criteria = extractCriteria(
    "Ich wohne in Wien ohne Wallbox, Budget 40000 EUR, brauche 400 km Reichweite, CarPlay und Sitzheizung."
  );

  assert.equal(criteria.language, "de");
  assert.equal(criteria.budgetMaxEUR, 40000);
  assert.equal(criteria.rangeFloorKm, 400);
  assert.equal(criteria.chargingAccess, "public");
  assert.ok(criteria.mustHaveFeatures.includes("apple_carplay"));
  assert.ok(criteria.mustHaveFeatures.includes("heated_seats"));
});

test("detects current message language for short car-name searches", () => {
  assert.equal(detectLanguage("Used Tesla Model 3"), "en");
  assert.equal(detectLanguage("Gebrauchter Tesla Model 3"), "de");
  assert.equal(detectLanguage("Budget 40000 EUR", "de"), "de");
  assert.equal(detectLanguage("Hello, I need an EV"), "en");
  assert.equal(detectLanguage("Hallo, ich suche ein E-Auto"), "de");
});

test("builds explicit reply-language instructions for LLM prompts", () => {
  assert.equal(languageLabel("en"), "English");
  assert.equal(languageLabel("de"), "German");
  assert.match(languageReplyInstruction("en"), /English only/);
  assert.match(languageReplyInstruction("de"), /German only/);
});

test("LLM criteria patches cannot override deterministic message language", () => {
  const criteria = applyCriteriaPatch(
    extractCriteria("Used Tesla Model 3"),
    { language: "de", brandPreferences: ["Tesla"], modelPreferences: ["Model 3"] },
    "Used Tesla Model 3",
    false
  );

  assert.equal(criteria.language, "en");
  assert.deepEqual(criteria.brandPreferences, ["Tesla"]);
  assert.deepEqual(criteria.modelPreferences, ["Model 3"]);
});

test("asks for clarification when no budget is available", () => {
  const criteria = extractCriteria("Ich brauche ein Auto fuer Wien mit guter Reichweite.");

  assert.equal(needsClarification(criteria), true);
});

test("merges conversational refinements and lets latest explicit constraints win", () => {
  const first = extractCriteria("Used EV under 35000 EUR for city commuting.");
  const refined = extractCriteria("make it under 18k and only SUVs", first);

  assert.equal(refined.budgetMaxEUR, 18000);
  assert.deepEqual(refined.bodyTypes, ["suv"]);
  assert.ok(refined.tripNeeds.includes("city"));
  assert.equal(refined.preferredCondition, "used");
});

test("replaces brand preferences when the user says only a new brand", () => {
  const first = extractCriteria("I want a Tesla car.");
  const refined = extractCriteria("Leave only Ford cars", first);

  assert.deepEqual(refined.brandPreferences, ["Ford"]);
  assert.deepEqual(refined.modelPreferences, []);
});

test("LLM criteria patches respect only-brand replacements", () => {
  const criteria = applyCriteriaPatch(
    extractCriteria("I want a Tesla car."),
    { brandPreferences: ["Ford"], modelPreferences: [] },
    "Leave only Ford cars",
    true
  );

  assert.deepEqual(criteria.brandPreferences, ["Ford"]);
  assert.deepEqual(criteria.modelPreferences, []);
});

test("removes individual criteria without clearing the full flow", () => {
  const criteria = extractCriteria("Used SUV under 35000 EUR with 450 km range and low mileage.");
  const withoutBody = removeCriteriaKey(criteria, "body");
  const withoutMileage = removeCriteriaKey(criteria, "mileage");

  assert.deepEqual(withoutBody.bodyTypes, []);
  assert.equal(withoutBody.budgetMaxEUR, 35000);
  assert.equal(withoutMileage.mileageTargetKm, null);
  assert.equal(withoutMileage.budgetMaxEUR, 35000);
});

test("extracts semantic premium, low-km, and battery-health criteria", () => {
  const criteria = extractCriteria(
    "I need to find the EV car that feels premium, has low km and good battery health under 20k euros."
  );

  assert.equal(criteria.budgetMaxEUR, 20000);
  assert.equal(criteria.mileageTargetKm, 30000);
  assert.equal(criteria.batterySoHMin, 90);
  assert.ok(criteria.qualitativeSignals.includes("premium"));
  assert.ok(criteria.qualitativeSignals.includes("low_mileage"));
  assert.ok(criteria.qualitativeSignals.includes("good_battery_health"));
});

test("extracts model intent from car-name searches", () => {
  const criteria = extractCriteria(
    "Kia EV6 under 45k for road trips, 450 km range, fast charging and CarPlay."
  );

  assert.equal(criteria.budgetMaxEUR, 45000);
  assert.equal(criteria.rangeFloorKm, 450);
  assert.deepEqual(criteria.brandPreferences, ["Kia"]);
  assert.deepEqual(criteria.modelPreferences, ["EV6"]);
  assert.ok(criteria.tripNeeds.includes("road_trip"));
});

test("extracts leisure cruising as a road-trip use case", () => {
  const criteria = extractCriteria("I'm thinking about just cruising");

  assert.ok(criteria.tripNeeds.includes("road_trip"));
});

test("resolveClarificationAnswer maps free-text replies to chip patches", () => {
  assert.deepEqual(resolveClarificationAnswer("just cruising", "use_case", "en"), {
    kind: "patch",
    patch: { tripNeeds: ["road_trip"] }
  });
  assert.deepEqual(resolveClarificationAnswer("But I already answered cruising", "use_case", "en"), {
    kind: "patch",
    patch: { tripNeeds: ["road_trip"] }
  });
  assert.deepEqual(resolveClarificationAnswer("mostly commuting to work", "use_case", "en"), {
    kind: "patch",
    patch: { tripNeeds: ["commute"] }
  });
  assert.deepEqual(resolveClarificationAnswer("home wallbox", "charging_or_range", "en"), {
    kind: "patch",
    patch: { chargingAccess: "home" }
  });
  assert.deepEqual(resolveClarificationAnswer("SUV please", "vehicle_preferences", "en"), {
    kind: "patch",
    patch: { bodyTypes: ["suv"] }
  });
  assert.equal(resolveClarificationAnswer("no preference", "use_case", "en")?.kind, "skip");
});

test("match route advances after a free-text use-case answer", async () => {
  const first = await runMatchRequest({ message: "Budget 10000 EUR" });
  assert.equal(first.type, "clarification");
  assert.equal(first.prompt?.key, "use_case");

  const second = await runMatchRequest({
    message: "I'm thinking about just cruising",
    sessionId: first.sessionId,
    previousCriteria: first.criteria,
    currentPromptKey: "use_case"
  });

  assert.equal(second.type, "clarification");
  assert.equal(second.prompt?.key, "charging_or_range");
  assert.ok(second.criteria.tripNeeds.includes("road_trip"));
});

test("extracts Tesla Model Y as a specific model intent", () => {
  const criteria = extractCriteria("Tesla Model Y under 60000 EUR for family road trips.");

  assert.deepEqual(criteria.brandPreferences, ["Tesla"]);
  assert.deepEqual(criteria.modelPreferences, ["Model Y"]);
});

test("LLM criteria patches cannot erase explicit car-name model mentions", () => {
  const criteria = applyCriteriaPatch(
    extractCriteria("I need a Tesla car."),
    { brandPreferences: ["Tesla"], modelPreferences: [] },
    "Actually Tesla Model Y under 60000 EUR for family road trips.",
    true
  );

  assert.deepEqual(criteria.brandPreferences, ["Tesla"]);
  assert.deepEqual(criteria.modelPreferences, ["Model Y"]);
});

test("extracts country origin intent without turning it into fixed brand picks", () => {
  const criteria = extractCriteria("Chinese SUV under 50000 EUR for family road trips and public charging.");

  assert.deepEqual(criteria.preferredBrandOrigins, ["china"]);
  assert.deepEqual(criteria.brandPreferences, []);
  assert.deepEqual(criteria.bodyTypes, ["suv"]);
});

test("extracts newer brand-origin schema values", () => {
  const korean = extractCriteria("Korean EV under 50000 EUR for family trips.");
  const american = extractCriteria("American EV under 60000 EUR for road trips.");

  assert.deepEqual(korean.preferredBrandOrigins, ["korea"]);
  assert.deepEqual(american.preferredBrandOrigins, ["us"]);
});

test("LLM criteria patches keep newer enum values from the schema", () => {
  const criteria = applyCriteriaPatch(
    extractCriteria("EV under 50000 EUR"),
    { preferredBrandOrigins: ["korea", "us"], bodyTypes: ["other", "minibus"] },
    "Korean or US minibus EV under 50000 EUR",
    false
  );

  assert.deepEqual(criteria.preferredBrandOrigins, ["korea", "us"]);
  assert.deepEqual(criteria.bodyTypes, ["other", "minibus"]);
});

test("normalizer returns structured fallback output with missing criteria", async () => {
  const normalized = await normalizeCriteria({
    message: "I need a premium EV with good battery health."
  });

  assert.ok(normalized.criteriaPatch);
  assert.ok(normalized.missingCriteria.includes("budget"));
  assert.equal(normalized.clarificationQuestion, "What budget should I respect: maximum purchase price or monthly lease target?");
});

test("extracts purchase budget ranges as min and max", () => {
  const criteria = extractCriteria("EV in the price range of 25-30k EUR for city driving.");

  assert.equal(criteria.budgetMinEUR, 25000);
  assert.equal(criteria.budgetMaxEUR, 30000);
});

test("scores in-range prices near the top of the budget band", () => {
  const vehicle = seedVehicles[0];
  assert.ok(vehicle);

  const rangedCriteria = {
    ...emptyCriteria(),
    budgetMinEUR: 25000,
    budgetMaxEUR: 30000,
  };
  const maxOnlyCriteria = {
    ...emptyCriteria(),
    budgetMaxEUR: 30000,
  };

  const rangedPrice = scorePrice({ ...vehicle, priceEUR: 27987 }, rangedCriteria);
  const maxOnlyPrice = scorePrice({ ...vehicle, priceEUR: 27987 }, maxOnlyCriteria);

  assert.ok(rangedPrice >= 94);
  assert.ok(maxOnlyPrice >= 96);
});

test("scoring breakdown excludes removed dimensions", () => {
  const vehicle = seedVehicles[0];
  assert.ok(vehicle);
  const breakdown = scoreVehicle(vehicle, extractCriteria("Budget 40000 EUR, CarPlay and heated seats."));

  assert.equal("tcoFit" in breakdown, false);
  assert.equal("personaFit" in breakdown, false);
  assert.equal("batteryHealthFit" in breakdown, false);
  assert.equal("semanticFit" in breakdown, false);
  assert.equal(Object.keys(breakdown).length, 7);
});

test("hard filters keep recommendations inside purchase budget", () => {
  const criteria = extractCriteria("Gebrauchtes E-Auto bis 35000 EUR fuer Stadt, CarPlay und Sitzheizung.");
  const result = matchVehicles(seedVehicles, criteria);

  assert.ok(result.recommendations.length > 0);
  for (const recommendation of result.recommendations) {
    assert.ok(recommendation.vehicle.priceEUR <= 35000);
  }
});

test("hard filters keep explicit mileage caps", () => {
  const criteria = extractCriteria("Used EV budget 90000 EUR, mileage under 20000 km.");
  const result = matchVehicles(seedVehicles, criteria);

  assert.ok(result.recommendations.length > 0);
  for (const recommendation of result.recommendations) {
    assert.equal(recommendation.vehicle.condition, "used");
    assert.ok((recommendation.vehicle.mileageKm ?? 0) <= 20000);
  }
});

test("hard filters apply monthly budgets to purchase-only listings", () => {
  const criteria = extractCriteria("Monthly budget 650 EUR for family road trips.");
  const vehicle = seedVehicles.find((item) => item.id === "tesla-model-y-used-2024-blue");
  assert.ok(vehicle);
  assert.equal(vehicle.monthlyLeaseEUR, null);

  const reasons = getHardFilterReasons(vehicle, criteria);

  assert.ok(reasons.some((reason) => reason.includes("above monthly budget")));
});

test("hard filters enforce required battery state-of-health", () => {
  const criteria = extractCriteria("Used EV budget 60000 EUR, battery health at least 94% must.");
  const result = matchVehicles(seedVehicles, criteria);

  assert.ok(result.recommendations.length > 0);
  for (const recommendation of result.recommendations) {
    assert.ok((recommendation.vehicle.batterySoH ?? 0) >= 94);
  }
  assert.ok(result.rejected.some((item) => item.reasons.some((reason) => reason.includes("battery state-of-health"))));
});

test("hard filters enforce explicit model searches", () => {
  const criteria = extractCriteria(
    "Kia EV6 under 45k for road trips, 450 km range, fast charging and CarPlay."
  );
  const result = matchVehicles(seedVehicles, criteria);

  assert.ok(result.recommendations.length > 0);
  for (const recommendation of result.recommendations) {
    assert.equal(recommendation.vehicle.model, "EV6");
  }
  assert.ok(result.rejected.some((item) => item.reasons.some((reason) => reason.includes("not EV6"))));
});

test("hard filters never substitute Tesla Model 3 for Tesla Model Y", () => {
  const criteria = extractCriteria(
    "Tesla Model Y under 60000 EUR for family road trips, 450 km range, public charging and winter."
  );
  const result = matchVehicles(seedVehicles, criteria, 12);

  assert.ok(result.recommendations.length > 0);
  for (const recommendation of result.recommendations) {
    assert.equal(recommendation.vehicle.make, "Tesla");
    assert.equal(recommendation.vehicle.model, "Model Y");
  }
  assert.ok(
    result.rejected.some(
      (item) =>
        item.vehicle.make === "Tesla" &&
        item.vehicle.model === "Model 3" &&
        item.reasons.some((reason) => reason.includes("not Model Y"))
    )
  );
});

test("hard filters enforce requested brand origin", () => {
  const criteria = extractCriteria(
    "Chinese EV under 60000 EUR for road trips, 420 km range, fast charging and CarPlay."
  );
  const result = matchVehicles(seedVehicles, criteria);

  assert.ok(result.recommendations.length > 0);
  for (const recommendation of result.recommendations) {
    assert.equal(recommendation.vehicle.brandOrigin, "china");
  }
  assert.ok(result.rejected.some((item) => item.vehicle.make === "Kia"));
  assert.ok(result.rejected.some((item) => item.vehicle.make === "Hyundai"));
  assert.ok(result.rejected.some((item) => item.reasons.some((reason) => reason.includes("brand origin"))));
});

test("hard filters enforce requested brand", () => {
  const criteria = extractCriteria("Ford car");
  const result = matchVehicles(seedVehicles, criteria);

  assert.equal(criteria.brandPreferences.includes("Ford"), true);
  assert.equal(result.recommendations.length, 0);
  assert.ok(result.rejected.some((item) => item.reasons.some((reason) => reason.includes("brand is"))));
});

test("used EVs with undisclosed battery health are explicit and not invented", () => {
  const criteria = extractCriteria("Gebrauchter SUV bis 50000 EUR, Batteriegesundheit wichtig.");
  const result = matchVehicles(seedVehicles, criteria);
  const audi = result.recommendations.find((match) => match.vehicle.id === "audi-q4-40-2023");

  assert.equal(audi?.vehicle.batterySoH, null);
  assert.ok(audi?.ruledOutReasons.includes("battery state-of-health is not disclosed"));
});

test("TCO uses criteria mileage and exposes assumptions", () => {
  const criteria = extractCriteria("Budget 45000 EUR, Pendeln 80 km taeglich.");
  const vehicle = seedVehicles.find((item) => item.id === "tesla-model-3-rwd-2024");
  assert.ok(vehicle);

  const tco = calculateTco(vehicle, criteria);

  assert.ok(tco.annualKmAssumption > 12000);
  assert.ok(tco.estimatedEnergyCostMonthly > 0);
  assert.equal(tco.assumptionsVersion, "AT-EV-alpha-2026-06");
});

test("RAG context retrieves matching vehicle payloads and feeds scoring evidence", () => {
  const criteria = extractCriteria("Budget 45000 EUR, Tesla Model 3 with long range and low running costs.");
  const ragContext = buildRagContext({
    message: criteria.rawPrompt,
    criteria,
    vehicles: seedVehicles,
    documents: []
  });
  const result = matchVehicles(seedVehicles, criteria, 6, { ragContext });
  const tesla = result.recommendations.find((match) => match.vehicle.id === "tesla-model-3-rwd-2024");

  assert.ok(tesla);
  assert.ok(tesla.ragScore > 0);
  assert.ok(tesla.ragEvidence.some((evidence) => evidence.sourceType === "vehicle_payload"));
});

test("RAG context retrieves relevant knowledge documents", () => {
  const criteria = extractCriteria("Budget 40000 EUR, Wohnung ohne Wallbox, brauche public charging info.");
  const ragContext = buildRagContext({
    message: criteria.rawPrompt,
    criteria,
    vehicles: seedVehicles,
    documents: [
      {
        id: "charging-doc",
        source: "test",
        heading: "Public charging",
        content: "Public charging stations and Ladeinfrastruktur are important for apartment drivers without a wallbox.",
        payload: {}
      },
      {
        id: "unrelated-doc",
        source: "test",
        heading: "Cargo",
        content: "Large vans carry bulky items.",
        payload: {}
      }
    ]
  });

  assert.equal(ragContext.documents[0]?.sourceId, "charging-doc");
  assert.equal(ragContext.documents[0]?.topic, "charging_network");
});

test("LLM explanation parser accepts fenced JSON responses", () => {
  const explanations = parseLlmExplanationJson(`\`\`\`json
{"explanations":[{"vehicleId":"tesla-model-3-rwd-2024","explanation":"Efficient and within budget."}]}
\`\`\``);

  assert.deepEqual(explanations, [
    {
      vehicleId: "tesla-model-3-rwd-2024",
      explanation: "Efficient and within budget."
    }
  ]);
});

test("match route returns clarification contract when budget is missing", async () => {
  const data = await runMatchRequest({ message: "Find me a premium EV with low mileage." });

  assert.equal(data.type, "clarification");
  assert.equal(typeof data.sessionId, "string");
  assert.ok(data.missingCriteria.includes("budget"));
  assert.equal(data.recommendations.length, 0);
});

test("match route greets casually without forcing budget chips when LLM is disabled", async () => {
  const data = await runMatchRequest({ message: "Hey" });

  assert.equal(data.type, "chat");
  assert.equal(typeof data.sessionId, "string");
  assert.equal(data.prompt, undefined);
  assert.match(data.assistantMessage, /FlowRyd/i);
  assert.doesNotMatch(data.assistantMessage, /hard limit/i);
  assert.equal(data.recommendations.length, 0);
});

test("match route asks for more information when only budget is known", async () => {
  const data = await runMatchRequest({ message: "Budget 40000 EUR." });

  assert.equal(data.type, "clarification");
  assert.ok(data.missingCriteria.includes("use_case"));
  assert.ok(data.missingCriteria.includes("charging_or_range"));
  assert.equal(data.recommendations.length, 0);
});

test("match route returns Tesla Model Y and not Tesla Model 3 for explicit Model Y searches", async () => {
  const data = await runMatchRequest({
    message: "Tesla Model Y under 60000 EUR for family road trips, 450 km range, public charging and winter."
  });

  assert.equal(data.type, "matches");
  assert.deepEqual(data.criteria.brandPreferences, ["Tesla"]);
  assert.deepEqual(data.criteria.modelPreferences, ["Model Y"]);
  assert.ok(data.recommendations.length > 0);
  for (const recommendation of data.recommendations) {
    assert.equal(recommendation.vehicle.make, "Tesla");
    assert.equal(recommendation.vehicle.model, "Model Y");
  }
});

matchRoute("match route collects criteria across turns and auto-matches when ready", async () => {
  const first = await runMatchRequest({ message: "My budget is 50000 EUR." });
  assert.equal(first.type, "clarification");

  const second = await runMatchRequest({
    message: "I commute in Vienna, public charging, SUV or crossover, CarPlay.",
    sessionId: first.sessionId,
    previousCriteria: first.criteria
  });

  assert.equal(second.type, "matches");
  assert.ok(second.recommendations.length > 0);
});

test("clarification catalog options apply valid criteria patches", () => {
  const keys: MissingCriteria[] = ["budget", "use_case", "charging_or_range", "vehicle_preferences"];
  for (const language of ["en", "de"] as const) {
    for (const key of keys) {
      const prompt = getClarificationPrompt(key, language);
      assert.ok(prompt.options.length >= 2);
      assert.equal(prompt.showMatchAction, false);

      const skipOptions = prompt.options.filter((option) => option.skip);
      assert.equal(skipOptions.length, 1);
      assert.equal(skipOptions[0]?.patch, undefined);

      for (const option of prompt.options) {
        assert.ok(option.label.length > 0);
        if (option.skip) continue;
        assert.ok(option.patch, `option ${option.id} should carry a patch`);
        const next = applyChipPatch(emptyCriteria("", language), option.patch!);
        assert.notEqual(JSON.stringify(next), JSON.stringify(emptyCriteria("", language)));
      }
    }
  }
});

test("match route advances to the next question after a chip selection", async () => {
  const first = await runMatchRequest({ message: "Budget 40000 EUR" });
  assert.equal(first.type, "clarification");
  assert.equal(first.prompt?.key, "use_case");

  const second = await runMatchRequest({
    message: "Under \u20ac25,000",
    sessionId: first.sessionId,
    previousCriteria: first.criteria,
    criteriaPatch: { budgetMaxEUR: 25000 },
    currentPromptKey: "budget"
  });

  assert.equal(second.type, "clarification");
  assert.equal(second.criteria.budgetMaxEUR, 25000);
  assert.notEqual(second.prompt?.key, "budget");
});

test("match route answers questions conversationally without chips", async () => {
  const first = await runMatchRequest({ message: "Budget 40000 EUR" });
  const second = await runMatchRequest({
    message: "I commute daily",
    sessionId: first.sessionId,
    previousCriteria: first.criteria
  });
  assert.equal(second.type, "clarification");
  assert.equal(second.prompt?.key, "charging_or_range");

  const third = await runMatchRequest({
    message: "What charging options are there?",
    sessionId: first.sessionId,
    previousCriteria: second.criteria,
    currentPromptKey: "charging_or_range"
  });

  assert.equal(third.type, "chat");
  assert.equal(third.prompt, undefined);
  assert.ok(third.assistantMessage.length > 0);
});

matchRoute("match route does not re-run matching for conversational asides after results", async () => {
  const first = await runMatchRequest({
    message: "EV under 60000 EUR for family road trips, 420 km range, public charging and CarPlay."
  });
  assert.equal(first.type, "matches");
  assert.ok(first.recommendations.length > 0);

  const second = await runMatchRequest({
    message: "Nice",
    sessionId: first.sessionId,
    previousCriteria: first.criteria
  });

  assert.equal(second.type, "chat");
  assert.equal(second.recommendations.length, 0);
});

test("match route auto-matches when enough criteria are collected", async () => {
  const first = await runMatchRequest({ message: "Budget 40000 EUR" });
  const second = await runMatchRequest({
    message: "I commute, SUV, home charging",
    sessionId: first.sessionId,
    previousCriteria: first.criteria
  });

  assert.equal(second.type, "matches");
  assert.ok(second.recommendations.length > 0);
});

test("match route still accepts an explicit show-matches request", async () => {
  const first = await runMatchRequest({ message: "Budget 60000 EUR" });
  const second = await runMatchRequest({
    message: "I commute, SUV, home charging",
    sessionId: first.sessionId,
    previousCriteria: first.criteria
  });
  assert.equal(second.type, "matches");

  const third = await runMatchRequest({
    message: "Show me matches",
    sessionId: first.sessionId,
    previousCriteria: second.criteria,
    intent: "show_matches"
  });

  assert.notEqual(third.type, "clarification");
});

test("match route skips a question the user waves off", async () => {
  const first = await runMatchRequest({ message: "Budget 40000 EUR" });
  assert.equal(first.type, "clarification");
  assert.equal(first.prompt?.key, "use_case");

  const second = await runMatchRequest({
    message: "No preference",
    sessionId: first.sessionId,
    previousCriteria: first.criteria,
    skippedKeys: ["use_case"],
    currentPromptKey: "use_case"
  });

  assert.equal(second.type, "clarification");
  assert.equal(second.prompt?.key, "charging_or_range");
});

matchRoute("match route fallback explanations use conversational paragraphs", async () => {
  const data = await runMatchRequest({
    message: "Used EV under 35k for city commuting, CarPlay, heated seats, and low running costs."
  });

  assert.equal(data.type, "matches");
  const explanation = data.recommendations[0]?.explanation ?? "";
  assert.match(explanation, /\n\n/);
  assert.doesNotMatch(explanation, /^\d+% match/i);
  assert.doesNotMatch(explanation, /\[E\d+\]/);
  assert.match(explanation, /fits your brief well|pas/i);
});

matchRoute("match route does not substitute a different Kia model for EV6 searches", async () => {
  const data = await runMatchRequest({
    message: "Kia EV6 under 70k for road trips, 450 km range, fast charging and CarPlay."
  });

  assert.equal(data.type, "matches");
  assert.ok(data.recommendations.length > 0);
  for (const recommendation of data.recommendations) {
    assert.equal(recommendation.vehicle.model, "EV6");
  }
});

matchRoute("match route keeps Chinese car requests to Chinese-origin brands", async () => {
  const data = await runMatchRequest({
    message: "Chinese SUV under 60000 EUR for family road trips, 420 km range, public charging and CarPlay."
  });

  assert.equal(data.type, "matches");
  assert.deepEqual(data.criteria.preferredBrandOrigins, ["china"]);
  assert.ok(data.recommendations.length > 0);
  for (const recommendation of data.recommendations) {
    assert.equal(recommendation.vehicle.brandOrigin, "china");
  }
});

matchRoute("match route returns Chinese cars without requiring budget", async () => {
  const data = await runMatchRequest({
    message: "I need a Chinese car."
  });

  assert.equal(data.type, "matches");
  assert.deepEqual(data.criteria.preferredBrandOrigins, ["china"]);
  assert.ok(data.recommendations.length > 0);
  for (const recommendation of data.recommendations) {
    assert.equal(recommendation.vehicle.brandOrigin, "china");
  }
});

matchRoute("match route returns Ford cars without requiring budget", async () => {
  const data = await runMatchRequest({
    message: "I need a Ford car."
  });

  assert.equal(data.type, "matches");
  assert.deepEqual(data.criteria.brandPreferences, ["Ford"]);
  assert.ok(data.recommendations.length > 0);
  for (const recommendation of data.recommendations) {
    assert.equal(recommendation.vehicle.make, "Ford");
  }
});

matchRoute("match route next batch excludes vehicles already shown in the session", async () => {
  const first = await runMatchRequest({
    message: "EV under 60000 EUR for family road trips, 420 km range, public charging and CarPlay."
  });
  assert.equal(first.type, "matches");
  assertNoDuplicateListingUrls(first.recommendations);

  const second = await runMatchRequest({
    message: "next batch",
    sessionId: first.sessionId
  });

  assert.equal(second.type, "matches");
  const firstIds = new Set(first.recommendations.map((recommendation) => recommendation.vehicle.id));
  assert.ok(second.recommendations.length > 0);
  for (const recommendation of second.recommendations) {
    assert.equal(firstIds.has(recommendation.vehicle.id), false);
  }
});

matchRoute("match route next batch still uses session exclusions when previousCriteria is supplied", async () => {
  const first = await runMatchRequest({
    message: "EV under 60000 EUR for family road trips, 420 km range, public charging and CarPlay."
  });
  assert.equal(first.type, "matches");

  const second = await runMatchRequest({
    message: "show me more",
    sessionId: first.sessionId,
    previousCriteria: first.criteria
  });

  assert.equal(second.type, "matches");
  const firstIds = new Set(first.recommendations.map((recommendation) => recommendation.vehicle.id));
  assert.ok(second.recommendations.length > 0);
  for (const recommendation of second.recommendations) {
    assert.equal(firstIds.has(recommendation.vehicle.id), false);
  }
});

matchRoute("match route explains the blocker for explicit model searches", async () => {
  const data = await runMatchRequest({
    message: "Kia EV6 under 15k for road trips, 450 km range, fast charging and CarPlay."
  });

  assert.equal(data.type, "no_matches");
  assert.equal(data.recommendations.length, 0);
  assert.match(data.rejectedSummary[0]?.reason ?? "", /above purchase budget/i);
  assert.doesNotMatch(data.assistantMessage, /range below requested/i);
});

matchRoute("match route returns no_matches when hard filters eliminate the inventory", async () => {
  const data = await runMatchRequest({ message: "New SUV under 15000 EUR with 600 km range." });

  assert.equal(data.type, "no_matches");
  assert.equal(data.recommendations.length, 0);
  assert.ok(Array.isArray(data.rejectedSummary));
});

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return process.env;
  const values: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return values;
}

function assertNoDuplicateListingUrls(recommendations: Array<{ vehicle: { listingUrl?: string } }>) {
  const listingUrls = recommendations
    .map((recommendation) => recommendation.vehicle.listingUrl?.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase())
    .filter((url): url is string => Boolean(url));
  assert.equal(new Set(listingUrls).size, listingUrls.length);
}
