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
  mergeConversationTurnClassification,
  parseTriggerJson,
  parseTurnKindJson,
  resolveConversationTurn
} from "../lib/conversational-intent.ts";
import { looksLikeBrandFocusQuestion, extractCriteria } from "../lib/criteria.ts";
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

test("routes English and German why-recommendation follow-ups to explanation", () => {
  assert.ok(detectPatternTriggers("Why are you suggesting these cars?").includes("explain_recommendations"));
  assert.ok(detectPatternTriggers("Warum schlägst du mir diese Autos vor?").includes("explain_recommendations"));
});

test("keeps deterministic explanation routes authoritative", async () => {
  const resolved = await resolveConversationTurn({
    message: "Why are you suggesting these cars?",
    currentPromptKey: "use_case"
  });

  assert.equal(resolved.trigger, "explain_recommendations");
  assert.equal(resolved.source, "pattern");
});

test("parseTriggerJson accepts trigger routing JSON", () => {
  assert.deepEqual(parseTriggerJson('{"trigger":"show_matches"}'), { trigger: "show_matches" });
  assert.deepEqual(parseTriggerJson('{"trigger":"brand_focus","criteriaPatch":{"brandPreferences":["Ford"]}}'), {
    trigger: "brand_focus",
    criteriaPatch: { brandPreferences: ["Ford"] }
  });
  assert.equal(parseTriggerJson('{"trigger":"invalid"}'), null);
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
  assert.equal(first.prompt?.key, "use_case");

  const second = await runMatchRequest({
    message: "what can it do",
    sessionId: first.sessionId,
    previousCriteria: first.criteria,
    currentPromptKey: "use_case"
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
  assert.ok(second.recommendations.some((match) => match.vehicle.make === "Ford"));
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
  assert.equal(first.type, "clarification");
  assert.equal(first.prompt?.key, "optimization");
  return await runMatchRequest({
    message: "Best value",
    sessionId: first.sessionId,
    previousCriteria: first.criteria,
    criteriaPatch: { optimizationDirective: "best_value" },
    currentPromptKey: "optimization"
  });
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
