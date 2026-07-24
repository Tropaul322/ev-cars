import assert from "node:assert/strict";
import test from "node:test";
import { detectConversationalIntent } from "../lib/chat-agent.ts";
import { extractCriteria } from "../lib/criteria.ts";
import { runMatchRequest } from "../lib/match-service.ts";

process.env.FLOWRYD_DISABLE_LLM = "1";
process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";

test("detects natural conversational intents", () => {
  assert.equal(detectConversationalIntent("Hey!"), "greeting");
  assert.equal(detectConversationalIntent("Thanks!"), "thanks");
  assert.equal(detectConversationalIntent("What can you help me with?"), "help");
  assert.equal(detectConversationalIntent("How are you?"), "small_talk");
  assert.equal(detectConversationalIntent("Family SUV under 40k"), null);
});

test("extracts under 50k please budgets without mistaking please for lease", () => {
  const criteria = extractCriteria("Under 50k please, for road trips");
  assert.equal(criteria.budgetMaxEUR, 50000);
  assert.equal(criteria.monthlyBudgetEUR, null);
  assert.ok(criteria.tripNeeds.includes("road_trip"));
});

test("extracts commuting and high cargo from natural phrasing", () => {
  const commute = extractCriteria("Mostly city and commuting, no home charger");
  assert.ok(commute.tripNeeds.includes("city"));
  assert.ok(commute.tripNeeds.includes("commute"));
  assert.equal(commute.chargingAccess, "public");

  const cargo = extractCriteria("We are 5 people, need lots of trunk space for weekend trips, budget 48000");
  assert.equal(cargo.passengers, 5);
  assert.equal(cargo.cargoNeeds, "high");
  assert.equal(cargo.budgetMaxEUR, 48000);
});

test("treats like Tesla but not Tesla as avoidance not preference", () => {
  const criteria = extractCriteria("Something like a Tesla but not Tesla, under 45k, good range for Autobahn");
  assert.ok(criteria.avoidedBrands.includes("Tesla"));
  assert.equal(criteria.brandPreferences.includes("Tesla"), false);
  assert.equal(criteria.budgetMaxEUR, 45000);
  assert.equal(criteria.rangeFloorKm, null);
  assert.ok(criteria.qualitativeSignals.includes("road_trip_comfort"));
  assert.ok(criteria.tripNeeds.includes("road_trip"));
});

test("keeps German conversation language across short budget replies", () => {
  const first = extractCriteria("Hallo, ich suche ein E-Auto für meine Familie");
  const second = extractCriteria("Budget maximal 50000 Euro", first);
  assert.equal(first.language, "de");
  assert.equal(second.language, "de");
  assert.equal(second.budgetMaxEUR, 50000);
  assert.ok(second.tripNeeds.includes("family"));
});

test("multi-turn chat: greeting then family search feels natural", async () => {
  const greeting = await runMatchRequest({ message: "Hey!" });
  assert.equal(greeting.type, "chat");
  assert.match(greeting.assistantMessage, /budget|EV|Austria|Österreich|FlowRyd/i);

  const search = await runMatchRequest({
    message: "Looking for a family SUV under 45k, need space for kids and luggage, around 400km range",
    sessionId: greeting.sessionId
  });
  assert.equal(search.type, "matches");
  assert.equal(search.criteria.budgetMaxEUR, 45000);
  assert.equal(search.criteria.cargoNeeds, "high");
  assert.ok(search.criteria.tripNeeds.includes("family"));
  assert.ok(search.recommendations.length > 0);
  assert.doesNotMatch(search.assistantMessage, /^Found \d+ matching EVs/i);
  const models = search.recommendations.map((item) => `${item.vehicle.make} ${item.vehicle.model}`);
  assert.equal(new Set(models).size, models.length);
});

test("multi-turn chat: thanks after matches stays conversational", async () => {
  const first = await runMatchRequest({
    message: "Used EV under 35000 for city commuting with CarPlay"
  });
  assert.equal(first.type, "matches");

  const thanks = await runMatchRequest({
    message: "Thanks!",
    sessionId: first.sessionId
  });
  assert.equal(thanks.type, "chat");
  assert.match(thanks.assistantMessage, /welcome|Gerne|refine|verfeinern|more/i);
});

test("multi-turn chat: help then lease commute search", async () => {
  const help = await runMatchRequest({ message: "What can you help me with?" });
  assert.equal(help.type, "chat");
  assert.match(help.assistantMessage, /budget|Austria|Österreich|lease|Leasing/i);

  const search = await runMatchRequest({
    message: "I commute 60km daily in Graz, leasing max 400/month",
    sessionId: help.sessionId
  });
  assert.equal(search.type, "matches");
  assert.equal(search.criteria.monthlyBudgetEUR, 400);
  assert.ok(search.criteria.tripNeeds.includes("commute"));
});

test("multi-turn German family flow keeps language and asks smart clarifications", async () => {
  const first = await runMatchRequest({ message: "Hallo, ich suche ein E-Auto für meine Familie" });
  assert.equal(first.type, "clarification");
  assert.equal(first.criteria.language, "de");
  assert.match(first.assistantMessage, /Budget|Familie/i);

  const second = await runMatchRequest({
    message: "Budget maximal 50000 Euro",
    sessionId: first.sessionId
  });
  assert.equal(second.criteria.language, "de");
  assert.equal(second.type, "clarification");
  assert.match(second.assistantMessage, /lad|Reichweite|Wallbox|Präferenz|Karosserie/i);

  const third = await runMatchRequest({
    message: "SUV mit großem Kofferraum und mindestens 450 km Reichweite",
    sessionId: second.sessionId
  });
  assert.equal(third.type, "matches");
  assert.equal(third.criteria.cargoNeeds, "high");
  assert.equal(third.criteria.rangeFloorKm, 450);
  assert.ok(third.recommendations.every((item) => item.vehicle.priceEUR <= 50000));
});

test("model follow-up under 50k please applies purchase budget", async () => {
  const first = await runMatchRequest({ message: "Do you have a Kia EV6?" });
  assert.equal(first.type, "matches");

  const second = await runMatchRequest({
    message: "Under 50k please, for road trips",
    sessionId: first.sessionId
  });
  assert.equal(second.criteria.budgetMaxEUR, 50000);
  assert.ok(second.criteria.tripNeeds.includes("road_trip"));
});

test("not-Tesla preference returns matches without forcing Tesla brand", async () => {
  const data = await runMatchRequest({
    message: "Something like a Tesla but not Tesla, under 45k, good range for Autobahn"
  });
  assert.notEqual(data.type, "clarification");
  assert.ok(data.criteria.avoidedBrands.includes("Tesla"));
  assert.equal(data.criteria.brandPreferences.includes("Tesla"), false);
  if (data.type === "matches") {
    assert.ok(data.recommendations.every((item) => item.vehicle.make.toLowerCase() !== "tesla"));
  }
});
