import assert from "node:assert/strict";
import test from "node:test";
import { buildLlmMessages, chatMessagesToLlmHistory, conversationContinues } from "../lib/llm-conversation.ts";
import type { ChatMessage } from "../lib/repositories/chat-repository.ts";

function makeMessage(role: "user" | "assistant", content: string, index: number): ChatMessage {
  return {
    id: `msg-${index}`,
    chatSessionId: "chat-1",
    testerRegistrationId: "tester-1",
    role,
    content,
    payload: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
  };
}

test("chatMessagesToLlmHistory strips the current user turn when already persisted", () => {
  const history = chatMessagesToLlmHistory(
    [
      makeMessage("user", "Budget 40000 EUR", 0),
      makeMessage("assistant", "What body type do you prefer?", 1),
      makeMessage("user", "Family SUV please", 2)
    ],
    "Family SUV please"
  );

  assert.equal(history.length, 2);
  assert.equal(history.at(-1)?.content, "What body type do you prefer?");
});

test("chatMessagesToLlmHistory keeps only the most recent turns", () => {
  const messages = Array.from({ length: 20 }, (_, index) =>
    makeMessage(index % 2 === 0 ? "user" : "assistant", `Turn ${index}`, index)
  );

  const history = chatMessagesToLlmHistory(messages);

  assert.equal(history.length, 14);
  assert.equal(history[0]?.content, "Turn 6");
  assert.equal(history.at(-1)?.content, "Turn 19");
});

test("conversationContinues is true when an assistant turn exists in history", () => {
  assert.equal(conversationContinues([]), false);
  assert.equal(
    conversationContinues([
      { role: "user", content: "Hey" },
      { role: "assistant", content: "Hello!" }
    ]),
    true
  );
});

test("buildLlmMessages prepends system prompt and appends the current user payload", () => {
  const messages = buildLlmMessages(
    "system rules",
    [
      { role: "user", content: "Budget 40000 EUR" },
      { role: "assistant", content: "Any range needs?" }
    ],
    JSON.stringify({ kind: "clarification", message: "Around 300 km" })
  );

  assert.equal(messages.length, 4);
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[0]?.content, "system rules");
  assert.equal(messages.at(-1)?.role, "user");
  assert.match(messages.at(-1)?.content ?? "", /Around 300 km/);
});
