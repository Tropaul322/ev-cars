import fs from "node:fs";
import path from "node:path";
import { createQueryEmbedding } from "../lib/embeddings.ts";
import { matchKnowledgeChunksByEmbedding } from "../lib/repositories/knowledge-repository.ts";

for (const [key, value] of Object.entries(loadEnv(path.join(process.cwd(), ".env.local")))) {
  if (typeof value === "string") process.env[key] = value;
}

const query = "public charging without wallbox apartment driver in Vienna";
const embedding = await createQueryEmbedding(query);

if (!embedding) {
  console.error("Embedding generation failed. Check OPENAI_API_KEY and OPENAI_EMBEDDING_MODEL.");
  process.exit(1);
}

console.log(`Generated query embedding with ${embedding.length} dimensions.`);

const chunks = await matchKnowledgeChunksByEmbedding(embedding, 3);
if (!chunks.length) {
  console.error("Vector search returned no chunks. Check knowledge_chunks.embedding in Supabase.");
  process.exit(1);
}

console.log("Top retrieved chunks:");
for (const chunk of chunks) {
  console.log(`- ${chunk.heading} (${chunk.source}) similarity=${chunk.similarity?.toFixed(3) ?? "n/a"}`);
}

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
