import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCriteria,
  hasHardBodyTypeConstraint,
  hasHardConditionConstraint
} from "../lib/criteria.ts";
import { classifyConversationTurn, looksLikeEvQuestion } from "../lib/conversational-intent.ts";
import { matchVehicles } from "../lib/scoring.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import { runMatchRequest } from "../lib/match-service.ts";

process.env.FLOWRYD_DISABLE_LLM = "1";
process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";
process.env.FLOWRYD_VEHICLE_STRUCTURED_SEARCH = "0";
process.env.FLOWRYD_VEHICLE_EMBEDDING_SEARCH = "0";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

test("no Tesla goes to avoidedBrands, not brandPreferences", () => {
  const criteria = extractCriteria(
    "EV up to 56000 for mountains and winter, AWD, heated seats, 450 km range, no Tesla please."
  );

  assert.deepEqual(criteria.avoidedBrands, ["Tesla"]);
  assert.equal(criteria.brandPreferences.includes("Tesla"), false);
  assert.ok(criteria.mustHaveFeatures.includes("awd"));
  assert.ok(criteria.mustHaveFeatures.includes("heated_seats"));
  assert.equal(criteria.mustHaveFeatures.includes("large_trunk"), false);
});

test("shopping need language keeps body and condition soft", () => {
  const criteria = extractCriteria(
    "I need a compact EV for Vienna under 35k, used is fine, mostly city driving."
  );

  assert.ok(criteria.bodyTypes.includes("compact"));
  assert.equal(criteria.preferredCondition, "used");
  assert.equal(hasHardBodyTypeConstraint(criteria), false);
  assert.equal(hasHardConditionConstraint(criteria), false);

  const result = matchVehicles(seedVehicles, criteria, 5);
  assert.ok(result.recommendations.length > 0);
});

test("large trunk preference is soft cargo, not a hard feature gate", () => {
  const criteria = extractCriteria(
    "Hallo, ich suche einen Familien-SUV bis 50000 Euro, grosser Kofferraum, mindestens 450 km Reichweite."
  );

  assert.equal(criteria.cargoNeeds, "high");
  assert.equal(criteria.mustHaveFeatures.includes("large_trunk"), false);
  assert.ok(matchVehicles(seedVehicles, criteria, 5).recommendations.length > 0);
});

test("winter wording alone does not force AWD must-have", () => {
  const criteria = extractCriteria("Family SUV under 50000 EUR with big cargo for winter trips.");
  assert.ok(criteria.tripNeeds.includes("winter"));
  assert.equal(criteria.mustHaveFeatures.includes("awd"), false);
  assert.equal(criteria.cargoNeeds, "high");
});

test("heat-pump knowledge questions stay conversational", async () => {
  assert.equal(looksLikeEvQuestion("How important is a heat pump in Austrian winters?"), true);
  assert.equal(classifyConversationTurn("How important is a heat pump in Austrian winters?"), "ev_question");

  const first = await runMatchRequest({ message: "Budget around 40000 EUR for a used EV." });
  const second = await runMatchRequest({
    message: "How important is a heat pump in Austrian winters?",
    sessionId: first.sessionId,
    previousCriteria: first.criteria,
    currentPromptKey: first.type === "clarification" || first.type === "chat" ? first.prompt?.key : undefined
  });

  assert.equal(second.type, "chat");
  assert.equal(second.prompt, undefined);
  assert.equal(second.recommendations.length, 0);
});

test("first turn with explicit optimization can match immediately", async () => {
  const response = await runMatchRequest({
    message:
      "Family SUV under 50000 EUR, home wallbox, about 450 km range for Autobahn trips with kids, optimize for best family fit."
  });

  assert.equal(response.type, "matches");
  assert.ok(response.recommendations.length > 0);
  assert.equal(response.criteria.optimizationDirective, "best_family_fit");
});
