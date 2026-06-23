export const defaultGeminiEmbeddingModel = "gemini-embedding-2";

export function geminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function geminiEmbeddingModel() {
  return process.env.GEMINI_EMBEDDING_MODEL?.trim() || defaultGeminiEmbeddingModel;
}

export async function createGeminiEmbedding(
  input: string,
  dimensions: number
): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = geminiEmbeddingModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        content: { parts: [{ text: input }] },
        output_dimensionality: dimensions
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { embedding?: { values?: number[] } };
    return normalizeGeminiEmbedding(payload.embedding?.values, dimensions);
  } catch {
    return null;
  }
}

function normalizeGeminiEmbedding(values: number[] | undefined, dimensions: number) {
  if (!Array.isArray(values)) return null;
  const embedding = values.filter((value) => Number.isFinite(value));
  if (embedding.length !== dimensions) return null;
  return embedding;
}
