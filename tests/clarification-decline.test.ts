import assert from "node:assert/strict";
import test from "node:test";
import {
  declinedOptionalPreferencesPatch,
  looksLikeDeclineAnswer,
  resolveClarificationAnswer,
  DEFAULT_DECLINED_RANGE_FLOOR_KM
} from "../lib/clarification-resolver.ts";
import { runMatchRequest } from "../lib/match-service.ts";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";

process.env.FLOWRYD_DISABLE_LLM = "1";
process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";

test("looksLikeDeclineAnswer recognizes No / none / nein", () => {
  for (const message of ["No", "no", "Nope", "None", "Nothing", "Nein", "no thanks", "no preference"]) {
    assert.equal(looksLikeDeclineAnswer(message), true, message);
  }
  assert.equal(looksLikeDeclineAnswer("SUV"), false);
  assert.equal(looksLikeDeclineAnswer("at least 400 km"), false);
});

test("looksLikeDeclineAnswer recognizes soft declines with extra wording", () => {
  for (const message of [
    "Nope, just looking for the options",
    "Nope, ust looking for the options",
    "No, just show me options",
    "just looking for options",
    "No specific features",
    "nothing particular thanks"
  ]) {
    assert.equal(looksLikeDeclineAnswer(message), true, message);
  }
  assert.equal(looksLikeDeclineAnswer("looking for options under 40000"), false);
});

test("resolveClarificationAnswer advances on soft decline for personal_wish", () => {
  assert.deepEqual(
    resolveClarificationAnswer("Nope, just looking for the options", "personal_wish", "en"),
    { kind: "patch", patch: { personalWish: "freedom" } }
  );
});

test("resolveClarificationAnswer advances on No for every prompt key", () => {
  assert.deepEqual(resolveClarificationAnswer("No", "budget", "en"), {
    kind: "patch",
    patch: { budgetMinEUR: 25000, budgetMaxEUR: 60000, monthlyBudgetEUR: null }
  });
  assert.equal(resolveClarificationAnswer("No", "use_case", "en")?.kind, "skip");
  assert.deepEqual(resolveClarificationAnswer("No", "charging_or_range", "en"), {
    kind: "patch",
    patch: { rangeFloorKm: DEFAULT_DECLINED_RANGE_FLOOR_KM }
  });
  assert.deepEqual(resolveClarificationAnswer("No", "personal_wish", "en"), {
    kind: "patch",
    patch: { personalWish: "freedom" }
  });
  const vehiclePrefs = resolveClarificationAnswer("No", "vehicle_preferences", "en");
  assert.equal(vehiclePrefs?.kind, "patch");
  if (vehiclePrefs?.kind === "patch") {
    assert.deepEqual(vehiclePrefs.patch.remove, ["features", "brand", "model"]);
    assert.equal(vehiclePrefs.patch.cargoNeeds, null);
    assert.equal(vehiclePrefs.patch.passengers, null);
    assert.ok((vehiclePrefs.patch.bodyTypes?.length ?? 0) > 0);
  }
});

test("declinedOptionalPreferencesPatch keeps body when already chosen", () => {
  const patch = declinedOptionalPreferencesPatch(true);
  assert.equal(patch.bodyTypes, undefined);
  assert.deepEqual(patch.remove, ["features", "brand", "model"]);
  assert.equal(patch.cargoNeeds, null);
  assert.equal(patch.passengers, null);
});

const hasSupabase = Boolean(getSupabaseRestConfig());
const live = hasSupabase ? test : test.skip;

live("No after home-charging / family SUV advances without nudge loop", async () => {
  let current = await runMatchRequest({
    message: "I need a family SUV under 50000 EUR, charging at home"
  });
  assert.equal(current.type, "clarification");
  assert.ok(current.type === "clarification");
  const firstKey = current.type === "clarification" ? current.prompt?.key : undefined;
  assert.ok(firstKey);

  current = await runMatchRequest({
    message: "No",
    sessionId: current.sessionId,
    previousCriteria: current.criteria,
    currentPromptKey: firstKey
  });

  assert.notEqual(current.type, "chat");
  // Must not re-ask the same clarification via the nudge template.
  const nextKey = current.type === "clarification" ? current.prompt?.key : undefined;
  assert.notEqual(nextKey, firstKey);
  assert.doesNotMatch(current.assistantMessage, /no rush|pick an option below/i);
  assert.deepEqual(current.criteria.mustHaveFeatures, []);
  assert.ok(current.criteria.bodyTypes.includes("suv"));
});
