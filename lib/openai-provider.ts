import OpenAI from "openai";

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
