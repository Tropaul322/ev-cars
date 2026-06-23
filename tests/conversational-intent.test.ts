import assert from "node:assert/strict";
import test from "node:test";
import { fallbackCapabilityMessage, fallbackChatGreeting } from "../lib/assistant-messages.ts";
import {
  classifyConversationTurn,
  isAssistantMetaQuestion,
  isCasualSmallTalk,
  looksLikeEvQuestion,
  mergeConversationTurnClassification,
  parseTurnKindJson
} from "../lib/conversational-intent.ts";
import { runMatchRequest } from "../lib/match-service.ts";

process.env.FLOWRYD_DISABLE_LLM = "1";
process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";

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
  assert.equal(classifyConversationTurn("Yooo, how are you ?"), "small_talk");
  assert.equal(classifyConversationTurn("What charging options are there?"), "ev_question");
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

test("capability and greeting fallbacks are available in German", () => {
  assert.match(fallbackCapabilityMessage({ language: "de" } as never), /FlowRyd/);
  assert.match(fallbackCapabilityMessage({ language: "de" } as never), /E-Auto/);
  assert.match(fallbackChatGreeting({ language: "de" } as never), /FlowRyd/);
  assert.doesNotMatch(
    fallbackChatGreeting({ language: "en" } as never, [{ role: "assistant", content: "Hi there!" }]),
    /FlowRyd/
  );
});
