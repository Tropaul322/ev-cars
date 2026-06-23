import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { RequestOptions } from "openai/core";
import { llmDebug } from "./llm-debug.ts";

export const defaultOpenAiModel = "gpt-4o-mini";
export const defaultOpenAiEmbeddingModel = "text-embedding-3-small";
export const defaultOpenAiEmbeddingDimensions = 1536;

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
  options?: RequestOptions
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
