import assert from "node:assert/strict";
import test from "node:test";
import { extractCriteria, needsClarification, removeCriteriaKey } from "../lib/criteria.ts";
import { normalizeCriteria } from "../lib/criteria-normalizer.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import { parseLlmExplanationJson } from "../lib/explanations.ts";
import { runMatchRequest } from "../lib/match-service.ts";
import { buildRagContext } from "../lib/rag.ts";
import { matchVehicles } from "../lib/scoring.ts";
import { calculateTco } from "../lib/tco.ts";

process.env.FLOWRYD_DISABLE_LLM = "1";
process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";

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

test("normalizer returns structured fallback output with missing criteria", async () => {
  const normalized = await normalizeCriteria({
    message: "I need a premium EV with good battery health."
  });

  assert.ok(normalized.criteriaPatch);
  assert.ok(normalized.missingCriteria.includes("budget"));
  assert.equal(normalized.clarificationQuestion, "What budget should I respect: maximum purchase price or monthly lease target?");
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

test("match route asks for criteria when greeting has no search intent without LLM", async () => {
  const data = await runMatchRequest({ message: "Hey" });

  assert.equal(data.type, "clarification");
  assert.equal(typeof data.sessionId, "string");
  assert.ok(data.assistantMessage.length > 0);
  assert.equal(data.recommendations.length, 0);
});

test("match route asks for more information when only budget is known", async () => {
  const data = await runMatchRequest({ message: "Budget 40000 EUR." });

  assert.equal(data.type, "clarification");
  assert.ok(data.missingCriteria.includes("use_case"));
  assert.ok(data.missingCriteria.includes("charging_or_range"));
  assert.equal(data.recommendations.length, 0);
});

test("match route collects criteria across turns before matching", async () => {
  const first = await runMatchRequest({ message: "My budget is 50000 EUR." });
  assert.equal(first.type, "clarification");

  const second = await runMatchRequest({
    message: "I commute in Vienna, no wallbox, SUV or crossover, CarPlay.",
    sessionId: first.sessionId
  });

  assert.equal(second.type, "matches");
  assert.ok(second.recommendations.length > 0);
});

test("match route fallback explanations use conversational paragraphs", async () => {
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

test("match route does not substitute a different Kia model for EV6 searches", async () => {
  const data = await runMatchRequest({
    message: "Kia EV6 under 70k for road trips, 450 km range, fast charging and CarPlay."
  });

  assert.equal(data.type, "matches");
  assert.ok(data.recommendations.length > 0);
  for (const recommendation of data.recommendations) {
    assert.equal(recommendation.vehicle.model, "EV6");
  }
});

test("match route explains the blocker for explicit model searches", async () => {
  const data = await runMatchRequest({
    message: "Kia EV6 under 45k for road trips, 450 km range, fast charging and CarPlay."
  });

  assert.equal(data.type, "no_matches");
  assert.equal(data.recommendations.length, 0);
  assert.match(data.rejectedSummary[0]?.reason ?? "", /above purchase budget/i);
  assert.doesNotMatch(data.assistantMessage, /range below requested/i);
});

test("match route returns no_matches when hard filters eliminate the inventory", async () => {
  const data = await runMatchRequest({ message: "New SUV under 15000 EUR with 600 km range." });

  assert.equal(data.type, "no_matches");
  assert.equal(data.recommendations.length, 0);
  assert.ok(Array.isArray(data.rejectedSummary));
});
