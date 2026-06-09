type GeminiEmbedContentResponse = {
  embedding?: { values?: number[] };
  embeddings?: Array<{ values?: number[] }>;
};

type OpenAiEmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

export type EmbeddingInputKind = "query" | "document";

const defaultGeminiEmbeddingModel = "gemini-embedding-2";
const defaultGeminiEmbeddingDimensions = 1536;

export function embeddingDimensions() {
  const configured = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? defaultGeminiEmbeddingDimensions);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultGeminiEmbeddingDimensions;
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

  if (process.env.GEMINI_API_KEY) {
    const gemini = await createGeminiEmbedding(text);
    if (gemini) return gemini;
  }

  if (process.env.OPENAI_API_KEY) {
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

async function createGeminiEmbedding(input: string): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const model = process.env.GEMINI_EMBEDDING_MODEL ?? defaultGeminiEmbeddingModel;
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/${modelPath}:embedContent?${new URLSearchParams({ key: apiKey })}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelPath,
          content: {
            parts: [{ text: input }]
          },
          output_dimensionality: embeddingDimensions()
        }),
        signal: AbortSignal.timeout(5000)
      }
    );

    if (!response.ok) return null;
    const data = (await response.json()) as GeminiEmbedContentResponse;
    const values = data.embedding?.values ?? data.embeddings?.[0]?.values;
    return normalizeEmbedding(values);
  } catch {
    return null;
  }
}

async function createOpenAiEmbedding(input: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input,
        dimensions: embeddingDimensions()
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) return null;
    const data = (await response.json()) as OpenAiEmbeddingResponse;
    return normalizeEmbedding(data.data?.[0]?.embedding);
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
