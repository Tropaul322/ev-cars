import { createOpenAiClient, openAiConfigured, openAiEmbeddingDimensions, openAiEmbeddingModel } from "./openai-provider.ts";

export type EmbeddingInputKind = "query" | "document";

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
  if (process.env.FLOWRYD_DISABLE_EMBEDDINGS === "1") return null;

  const text = formatEmbeddingInput(input, kind, title);
  if (!text.trim()) return null;

  if (openAiConfigured()) {
    return createOpenAiEmbedding(text);
  }

  return null;
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
      { timeout: 5000 }
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
