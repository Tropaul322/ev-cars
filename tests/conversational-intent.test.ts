import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fallbackCapabilityMessage, fallbackChatGreeting } from "../lib/assistant-messages.ts";
import {
  classifyConversationTurn,
  detectPatternTriggers,
  isAssistantMetaQuestion,
  isCasualSmallTalk,
  isExplicitShowMatches,
  looksLikeEvQuestion,
  looksLikeNonEvVehicleRequest,
  mergeConversationTurnClassification,
  parseTriggerJson,
  parseTurnKindJson,
  resolveConversationTurn,
  resolveConversationTurnPatternOnly
} from "../lib/conversational-intent.ts";
import { looksLikeBrandFocusQuestion, looksLikeBrandWidenRequest, extractCriteria } from "../lib/criteria.ts";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";
import { runMatchRequest } from "../lib/match-service.ts";

for (const [key, value] of Object.entries(loadEnv(path.join(process.cwd(), ".env.local")))) {
  if (typeof value === "string") process.env[key] = value;
}

process.env.FLOWRYD_DISABLE_LLM = "1";
process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";

const hasSupabaseInventory = Boolean(getSupabaseRestConfig());
const matchRoute = hasSupabaseInventory ? test : test.skip;

test("detects assistant capability questions", () => {
  assert.equal(isAssistantMetaQuestion("What can you do?"), true);
  assert.equal(isAssistantMetaQuestion("what can it do"), true);
  assert.equal(isAssistantMetaQuestion("How does this work?"), true);
  assert.equal(isAssistantMetaQuestion("Was kannst du für mich tun?"), true);
  assert.equal(isAssistantMetaQuestion("Budget 40000 EUR"), false);
  assert.equal(isAssistantMetaQuestion("I need an SUV under 50k"), false);
});

test("detects casual small talk and greetings", () => {
  assert.equal(isCasualSmallTalk("Yooo, how are you ?"), true);
  assert.equal(isCasualSmallTalk("Hey"), true);
  assert.equal(isCasualSmallTalk("how are you"), true);
  assert.equal(isCasualSmallTalk("thanks!"), true);
  assert.equal(isCasualSmallTalk("Ok can you show them?"), false);
  assert.equal(isCasualSmallTalk("Hey, can you find me a Chinese EV?"), false);
  assert.equal(classifyConversationTurn("Yooo, how are you ?"), "small_talk");
  assert.equal(classifyConversationTurn("Hey, can you find me a Chinese EV?"), "criteria");
  assert.equal(classifyConversationTurn("What charging options are there?"), "ev_question");
  assert.equal(classifyConversationTurn("What about Ford?"), "criteria");
  assert.equal(classifyConversationTurn("Ok can you show them?"), "show_matches");
  assert.equal(
    classifyConversationTurn("Which electric vehicle gives me the best price-to-performance ratio right now?"),
    "criteria"
  );
  assert.equal(looksLikeEvQuestion("Which electric vehicle gives me the best price-to-performance ratio right now?"), false);
  assert.equal(isExplicitShowMatches("Ok can you show them?"), true);
  assert.equal(looksLikeBrandFocusQuestion("What about Ford?"), true);
  assert.equal(looksLikeEvQuestion("What charging options are there?"), true);
  assert.equal(looksLikeEvQuestion("how are you?"), false);
});

test("mergeConversationTurnClassification keeps definite pattern hits", () => {
  assert.equal(mergeConversationTurnClassification("small_talk", "criteria"), "small_talk");
  assert.equal(mergeConversationTurnClassification("meta", "criteria"), "meta");
  assert.equal(mergeConversationTurnClassification("show_matches", "small_talk"), "show_matches");
});

test("mergeConversationTurnClassification prefers criteria from the LLM", () => {
  assert.equal(mergeConversationTurnClassification("criteria", "small_talk"), "small_talk");
  assert.equal(mergeConversationTurnClassification("criteria", "ev_question"), "ev_question");
  assert.equal(mergeConversationTurnClassification("ev_question", "criteria"), "criteria");
  assert.equal(mergeConversationTurnClassification("criteria", "criteria"), "criteria");
  assert.equal(mergeConversationTurnClassification("criteria", null), "criteria");
});

test("detectPatternTriggers surfaces likely handlers for follow-up requests", () => {
  assert.deepEqual(detectPatternTriggers("Ok can you show them?"), ["show_matches"]);
  assert.ok(detectPatternTriggers("What about Ford?").includes("brand_focus"));
  assert.ok(detectPatternTriggers("show more").includes("next_batch"));
});

test("detects brand-widen requests in EN and DE", () => {
  assert.equal(looksLikeBrandWidenRequest("What other car brands you can suggest?"), true);
  assert.equal(looksLikeBrandWidenRequest("What other brands can you suggest?"), true);
  assert.equal(looksLikeBrandWidenRequest("any brand is fine"), true);
  assert.equal(looksLikeBrandWidenRequest("welche Marken kannst du vorschlagen?"), true);
  assert.equal(looksLikeBrandWidenRequest("andere Marken bitte"), true);
  assert.equal(looksLikeBrandWidenRequest("egal welche Marke"), true);
  assert.equal(looksLikeBrandWidenRequest("What about Ford?"), false);
  assert.equal(looksLikeBrandWidenRequest("show me sporty 2-seaters"), false);
});

test("brand-widen patterns prefer update_criteria over ev_question", () => {
  const triggers = detectPatternTriggers("What other car brands can you suggest?");
  assert.ok(triggers.includes("update_criteria"));
  assert.equal(triggers.includes("ev_question"), false);
  assert.equal(classifyConversationTurn("What other car brands can you suggest?"), "criteria");
});

test("pattern-only resolution clears brand on brand-widen", () => {
  const resolved = resolveConversationTurnPatternOnly({
    message: "What other car brands can you suggest?"
  });
  assert.equal(resolved.trigger, "update_criteria");
  assert.deepEqual(resolved.criteriaPatch?.remove?.slice().sort(), ["brand", "model"]);
});

test("routes English and German why-recommendation follow-ups to explanation", () => {
  assert.ok(detectPatternTriggers("Why are you suggesting these cars?").includes("explain_recommendations"));
  assert.ok(detectPatternTriggers("Warum schlägst du mir diese Autos vor?").includes("explain_recommendations"));
  assert.ok(detectPatternTriggers("Why this one?").includes("explain_recommendations"));
  assert.ok(detectPatternTriggers("Why did this rank above the other?").includes("explain_recommendations"));
  assert.ok(detectPatternTriggers("Warum dieses?").includes("explain_recommendations"));
  assert.ok(detectPatternTriggers("Warum steht das über dem anderen?").includes("explain_recommendations"));
});

test("routes explain-the-results follow-ups to explanation without rematching", () => {
  for (const message of [
    "Can you explain the results ?",
    "Can you explain the results?",
    "Explain the results",
    "explain these recommendations",
    "Can you explain these cars?",
    "Erklär die Ergebnisse",
    "Kannst du die Ergebnisse erklären?"
  ]) {
    assert.ok(
      detectPatternTriggers(message).includes("explain_recommendations"),
      `expected explain route for: ${message}`
    );
    assert.equal(
      resolveConversationTurnPatternOnly({ message }).trigger,
      "explain_recommendations",
      `expected pattern-only explain for: ${message}`
    );
  }
});

test("does not route unrelated criteria or EV questions to explanation", () => {
  for (const message of [
    "Why do I need 450 km range?",
    "Why an SUV?",
    "Why is range important for EVs?",
    "Warum brauche ich so viel Reichweite?",
    "Budget 40000 EUR"
  ]) {
    assert.equal(
      detectPatternTriggers(message).includes("explain_recommendations"),
      false,
      `expected no explain route for: ${message}`
    );
  }
});

test("falls back to pattern explanation route when LLM is disabled", async () => {
  const resolved = await resolveConversationTurn({
    message: "Why are you suggesting these cars?",
    currentPromptKey: "use_case"
  });

  assert.equal(resolved.trigger, "explain_recommendations");
  assert.equal(resolved.source, "pattern");
});

test("pattern fallback routes bare Any to clarify during active prompt", () => {
  const resolved = resolveConversationTurnPatternOnly({
    message: "Any",
    currentPromptKey: "vehicle_preferences"
  });
  assert.equal(resolved.trigger, "clarify");
  assert.notEqual(resolved.trigger, "small_talk");
});

test("pattern fallback routes explain-the-results without rematch", () => {
  const resolved = resolveConversationTurnPatternOnly({
    message: "Can you explain the results ?"
  });
  assert.equal(resolved.trigger, "explain_recommendations");
});

test("parseTriggerJson accepts trigger routing JSON", () => {
  assert.deepEqual(parseTriggerJson('{"trigger":"show_matches"}'), { trigger: "show_matches" });
  assert.deepEqual(parseTriggerJson('{"trigger":"brand_focus","criteriaPatch":{"brandPreferences":["Ford"]}}'), {
    trigger: "brand_focus",
    criteriaPatch: { brandPreferences: ["Ford"] }
  });
  assert.deepEqual(parseTriggerJson('{"trigger":"non_ev_request"}'), { trigger: "non_ev_request" });
  assert.equal(parseTriggerJson('{"trigger":"invalid"}'), null);
});

test("detects non-EV vehicle requests like BMW M3", () => {
  assert.equal(looksLikeNonEvVehicleRequest("I want a BMW M3"), true);
  assert.equal(looksLikeNonEvVehicleRequest("zeig mir einen Golf GTI"), true);
  assert.equal(looksLikeNonEvVehicleRequest("I need a petrol car"), true);
  assert.equal(looksLikeNonEvVehicleRequest("I want a BMW"), false);
  assert.equal(looksLikeNonEvVehicleRequest("I want a BMW i4"), false);
  assert.equal(looksLikeNonEvVehicleRequest("Show me a Tesla Model Y"), false);
  assert.ok(detectPatternTriggers("I want a BMW M3").includes("non_ev_request"));
  assert.equal(
    resolveConversationTurnPatternOnly({ message: "I want a BMW M3" }).trigger,
    "non_ev_request"
  );
});

test("match request declines non-EV cars without starting clarification", async () => {
  const response = await runMatchRequest({ message: "I want a BMW M3" });

  assert.equal(response.type, "chat");
  assert.equal(response.prompt, undefined);
  assert.match(response.assistantMessage, /electric|EV/i);
  assert.doesNotMatch(response.assistantMessage, /budget works for you/i);
});

test("parseTurnKindJson accepts classifier JSON", () => {
  assert.equal(parseTurnKindJson('{"turnKind":"small_talk"}'), "small_talk");
  assert.equal(parseTurnKindJson("```json\n{\"turnKind\":\"ev_question\"}\n```"), "ev_question");
  assert.equal(parseTurnKindJson('{"turnKind":"invalid"}'), null);
});

test("match request answers capability questions without budget chips", async () => {
  const response = await runMatchRequest({ message: "What can you do?" });

  assert.equal(response.type, "chat");
  assert.equal(response.prompt, undefined);
  assert.match(response.assistantMessage, /FlowRyd/i);
  assert.doesNotMatch(response.assistantMessage, /budget works for you/i);
});

test("match request answers casual greetings conversationally without budget chips", async () => {
  const response = await runMatchRequest({ message: "Yooo, how are you ?" });

  assert.equal(response.type, "chat");
  assert.equal(response.prompt, undefined);
  assert.match(response.assistantMessage, /FlowRyd/i);
  assert.doesNotMatch(response.assistantMessage, /hard limit/i);
  assert.doesNotMatch(response.assistantMessage, /purchase price/i);
});

test("match request keeps capability answers during an active clarification flow", async () => {
  const first = await runMatchRequest({ message: "Budget 40000 EUR" });
  assert.equal(first.type, "clarification");
  assert.equal(first.prompt?.key, "vehicle_preferences");

  const second = await runMatchRequest({
    message: "what can it do",
    sessionId: first.sessionId,
    previousCriteria: first.criteria,
    currentPromptKey: "vehicle_preferences"
  });

  assert.equal(second.type, "chat");
  assert.equal(second.prompt, undefined);
  assert.match(second.assistantMessage, /FlowRyd/i);
  assert.equal(second.criteria.budgetMaxEUR, 40000);
});

test("brand focus narrows brand preferences", () => {
  const first = extractCriteria("American car like Ford or Tesla around 35k EUR with good range for trips");
  const second = extractCriteria("What about Ford?", first);

  assert.deepEqual(second.brandPreferences, ["Ford"]);
});

matchRoute("match request re-runs inventory after a brand focus follow-up", async () => {
  const first = await answerOptimizationPrompt(
    await runMatchRequest({
      message: "American car like Ford or Tesla around 35k EUR with good range for trips"
    })
  );
  assert.equal(first.type, "matches");

  const second = await runMatchRequest({
    message: "What about Ford?",
    sessionId: first.sessionId,
    previousCriteria: first.criteria
  });

  assert.notEqual(second.type, "chat");
  assert.deepEqual(second.criteria.brandPreferences, ["Ford"]);
  const ranked =
    second.type === "matches"
      ? [...second.recommendations, ...(second.alternativeRecommendations ?? [])]
      : second.recommendations;
  assert.ok(ranked.some((match) => match.vehicle.make === "Ford"));
});

matchRoute("match request shows listings when user asks to show them", async () => {
  const first = await answerOptimizationPrompt(
    await runMatchRequest({
      message: "American car like Ford or Tesla around 35k EUR with good range for trips"
    })
  );
  assert.equal(first.type, "matches");

  const second = await runMatchRequest({
    message: "Ok can you show them?",
    sessionId: first.sessionId,
    previousCriteria: first.criteria
  });

  assert.equal(second.type, "matches");
  assert.ok(second.recommendations.length > 0);
});

async function answerOptimizationPrompt(first: Awaited<ReturnType<typeof runMatchRequest>>) {
  let current = first;
  for (let turn = 0; turn < 8; turn += 1) {
    if (current.type === "matches" || current.type === "no_matches") return current;
    assert.equal(current.type, "clarification");
    const key = current.prompt?.key;
    assert.ok(key);

    if (key === "optimization") {
      return await runMatchRequest({
        message: "Best value",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { optimizationDirective: "best_value" },
        currentPromptKey: "optimization"
      });
    }

    if (key === "vehicle_preferences") {
      current = await runMatchRequest({
        message: "SUV",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { bodyTypes: ["suv"] },
        currentPromptKey: "vehicle_preferences"
      });
      continue;
    }

    if (key === "charging_or_range") {
      current = await runMatchRequest({
        message: "at least 400 km range",
        sessionId: current.sessionId,
        previousCriteria: current.criteria,
        criteriaPatch: { rangeFloorKm: 400 },
        currentPromptKey: "charging_or_range"
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

    throw new Error(`unhandled clarification key in answerOptimizationPrompt: ${key}`);
  }
  throw new Error("answerOptimizationPrompt exceeded clarification budget");
}

test("capability and greeting fallbacks are available in German", () => {
  assert.match(fallbackCapabilityMessage({ language: "de" } as never), /FlowRyd/);
  assert.match(fallbackCapabilityMessage({ language: "de" } as never), /E-Auto/);
  assert.match(fallbackChatGreeting({ language: "de" } as never), /FlowRyd/);
  assert.doesNotMatch(
    fallbackChatGreeting({ language: "en" } as never, [{ role: "assistant", content: "Hi there!" }]),
    /FlowRyd/
  );
});

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return values;
}
