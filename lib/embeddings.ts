import { createGeminiEmbedding, geminiConfigured } from "./gemini-provider.ts";
import { matchDebug, matchDebugWarn } from "./match-debug.ts";
import {
  createOpenAiClient,
  openAiChatTimeout,
  openAiConfigured,
  openAiEmbeddingDimensions,
  openAiEmbeddingModel
} from "./openai-provider.ts";

export type EmbeddingInputKind = "query" | "document";
export type EmbeddingProvider = "openai" | "gemini";

export function embeddingDimensions() {
  return openAiEmbeddingDimensions();
}

export async function createQueryEmbedding(input: string): Promise<number[] | null> {
  return createEmbedding(input, "query");
}

export async function createDocumentEmbedding(
  content: string,
  title?: string | null
): Promise<number[] | null> {
  return createEmbedding(content, "document", title);
}

export async function createEmbedding(
  input: string,
  kind: EmbeddingInputKind,
  title?: string | null
): Promise<number[] | null> {
  const result = await createEmbeddingWithProvider(input, kind, title);
  return result.embedding;
}

export async function createEmbeddingWithProvider(
  input: string,
  kind: EmbeddingInputKind,
  title?: string | null
): Promise<{ embedding: number[] | null; provider?: EmbeddingProvider; status: "ok" | "disabled" | "unavailable" }> {
  if (process.env.FLOWRYD_DISABLE_EMBEDDINGS === "1") {
    return { embedding: null, status: "disabled" };
  }

  const text = formatEmbeddingInput(input, kind, title);
  if (!text.trim()) {
    return { embedding: null, status: "unavailable" };
  }

  if (openAiConfigured()) {
    const openAiEmbedding = await createOpenAiEmbedding(text);
    if (openAiEmbedding) {
      matchDebug("embeddings.query", { provider: "openai", dimensions: openAiEmbedding.length });
      return { embedding: openAiEmbedding, provider: "openai", status: "ok" };
    }
    matchDebugWarn("embeddings.openai-failed", { reason: "falling back to Gemini when configured" });
  }

  if (geminiConfigured()) {
    const geminiEmbedding = await createGeminiEmbedding(text, embeddingDimensions());
    if (geminiEmbedding) {
      matchDebug("embeddings.query", { provider: "gemini", dimensions: geminiEmbedding.length });
      return { embedding: geminiEmbedding, provider: "gemini", status: "ok" };
    }
    matchDebugWarn("embeddings.gemini-failed", { reason: "Gemini embedding request failed" });
  }

  matchDebugWarn("embeddings.unavailable", {
    reason: "No embedding provider produced a query vector",
    openAiConfigured: openAiConfigured(),
    geminiConfigured: geminiConfigured()
  });
  return { embedding: null, status: "unavailable" };
}

function formatEmbeddingInput(input: string, kind: EmbeddingInputKind, title?: string | null) {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  if (kind === "query") {
    return `task: search result | query: ${normalized}`;
  }

  const documentTitle = title?.trim() || "none";
  return `title: ${documentTitle} | text: ${normalized}`;
}

async function createOpenAiEmbedding(input: string): Promise<number[] | null> {
  if (!openAiConfigured()) return null;

  try {
    const response = await createOpenAiClient().embeddings.create(
      {
        model: openAiEmbeddingModel(),
        input,
        dimensions: embeddingDimensions()
      },
      { timeout: openAiChatTimeout("embeddings") }
    );
    return normalizeEmbedding(response.data[0]?.embedding);
  } catch {
    return null;
  }
}

function normalizeEmbedding(values: number[] | undefined) {
  if (!Array.isArray(values)) return null;
  const embedding = values.filter((value) => Number.isFinite(value));
  if (!embedding.length) return null;

  const expected = embeddingDimensions();
  if (embedding.length !== expected) return null;
  return embedding;
}
