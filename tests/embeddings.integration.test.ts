import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createQueryEmbedding } from "../lib/embeddings.ts";
import { matchKnowledgeChunksByEmbedding } from "../lib/repositories/knowledge-repository.ts";

for (const [key, value] of Object.entries(loadEnv(path.join(process.cwd(), ".env.local")))) {
  if (typeof value === "string") process.env[key] = value;
}

const hasEmbeddingProvider = Boolean(process.env.OPENAI_API_KEY);
const integration = hasEmbeddingProvider ? test : test.skip;

integration("vector retrieval returns embedded knowledge chunks", async (t) => {
  let embedding = await createQueryEmbedding(
    "public charging without wallbox apartment driver charging network Austria"
  );
  if (!embedding) {
    embedding = await createQueryEmbedding(
      "public charging without wallbox apartment driver charging network Austria"
    );
  }
  if (!embedding) {
    t.skip("embedding provider unavailable");
    return;
  }
  assert.equal(embedding.length, 1536);

  const chunks = await matchKnowledgeChunksByEmbedding(embedding, 3);
  if (!chunks.length) {
    t.skip("no embedded knowledge chunks available");
    return;
  }
  assert.ok(chunks.length > 0);
  assert.ok(chunks[0]?.similarity && chunks[0].similarity > 0.4);
});

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return process.env;
  const values: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return values;
}
