import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { llmDebug } from "./llm-debug.ts";

type OpenAiChatCompletionOptions = NonNullable<
  Parameters<OpenAI["chat"]["completions"]["create"]>[1]
>;

export const defaultOpenAiModel = "gpt-4o-mini";
export const defaultOpenAiEmbeddingModel = "text-embedding-3-small";
export const defaultOpenAiEmbeddingDimensions = 1536;

const defaultOpenAiChatTimeoutsMs: Record<string, number> = {
  "criteria-normalizer": 2500,
  "turn-classifier": 2500,
  "match-scoring": 4500,
  "match-explanation": 6000,
  "assistant-message": 4500,
  embeddings: 4000
};

export function openAiChatTimeout(stage: string, fallback = 5000) {
  const configured = Number(process.env.FLOWRYD_LLM_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return defaultOpenAiChatTimeoutsMs[stage] ?? fallback;
}

export function openAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function openAiModel() {
  return process.env.OPENAI_MODEL ?? defaultOpenAiModel;
}

export function openAiEmbeddingModel() {
  return process.env.OPENAI_EMBEDDING_MODEL ?? defaultOpenAiEmbeddingModel;
}

export function openAiEmbeddingDimensions() {
  const configured = Number(process.env.OPENAI_EMBEDDING_DIMENSIONS ?? defaultOpenAiEmbeddingDimensions);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultOpenAiEmbeddingDimensions;
}

export function createOpenAiClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    maxRetries: 0
  });
}

export async function createOpenAiChatCompletion(
  stage: string,
  params: ChatCompletionCreateParamsNonStreaming,
  options?: OpenAiChatCompletionOptions
) {
  try {
    const response = await createOpenAiClient().chat.completions.create(params, options);
    llmDebug(stage, {
      ok: true,
      model: params.model,
      content: response.choices[0]?.message?.content ?? null,
      finishReason: response.choices[0]?.finish_reason ?? null,
      usage: response.usage ?? null
    });
    return response;
  } catch (error) {
    llmDebug(stage, {
      ok: false,
      model: params.model,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
