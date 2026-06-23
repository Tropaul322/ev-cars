import type { ChatMessage } from "./repositories/chat-repository.ts";

export type LlmConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type LlmChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const DEFAULT_MAX_MESSAGES = 14;
const MAX_MESSAGE_CHARS = 1200;

export function chatMessagesToLlmHistory(
  messages: ChatMessage[],
  currentMessage?: string
): LlmConversationTurn[] {
  let history = messages.map((message) => ({
    role: message.role,
    content: truncateMessage(message.content)
  }));

  const last = history.at(-1);
  if (
    last?.role === "user" &&
    currentMessage &&
    normalizeForCompare(last.content) === normalizeForCompare(currentMessage)
  ) {
    history = history.slice(0, -1);
  }

  return trimHistory(history, DEFAULT_MAX_MESSAGES);
}

export function buildLlmMessages(
  systemPrompt: string,
  history: LlmConversationTurn[],
  currentUserContent: string,
  maxMessages = DEFAULT_MAX_MESSAGES
): LlmChatMessage[] {
  const recent = trimHistory(history, maxMessages);
  return [
    { role: "system", content: systemPrompt },
    ...recent,
    { role: "user", content: currentUserContent }
  ];
}

function trimHistory(history: LlmConversationTurn[], maxMessages: number) {
  return history.slice(-maxMessages);
}

function truncateMessage(content: string) {
  const trimmed = content.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_MESSAGE_CHARS ? `${trimmed.slice(0, MAX_MESSAGE_CHARS)}…` : trimmed;
}

function normalizeForCompare(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function conversationContinues(history: LlmConversationTurn[] = []) {
  return history.some((turn) => turn.role === "assistant");
}
