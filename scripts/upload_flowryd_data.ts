import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { normalizeFlowrydVehicle, type RawInventoryRow } from "../lib/data/flowryd-normalization.ts";
import { seedVehicles } from "../lib/data/seed-vehicles.ts";
import { createDocumentEmbedding, embeddingDimensions } from "../lib/embeddings.ts";
import { buildVehicleEmbeddingText, vehicleTitle } from "../lib/vehicle-embedding-text.ts";

type RawRagRow = {
  source: string;
  heading: string;
  text_excerpt: string;
};

type KnowledgeChunkUploadRow = {
  id: string;
  document_id: string;
  topic: string;
  source: string;
  language: "de" | "en";
  heading: string;
  content: string;
  content_hash: string;
  embedding: string | null;
  metadata: unknown;
};

type UploadResult = {
  table: string;
  attempted: number;
  inserted: number;
};

const root = process.cwd();
const env = loadEnv(path.join(root, ".env.local"));
for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string") process.env[key] = value;
}
if (env.FLOWRYD_SKIP_EMBEDDINGS === "1") {
  process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";
}
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  env.SUPABASE_SERVICE_ROLE_KEY ??
  env.SUPABASE_ANON_KEY ??
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
  );
}

const inventoryPath = path.join(root, "data", "flowryd_site", "inventory.json");
const ragPath = path.join(root, "data", "flowryd_site", "rag.json");

const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8")) as RawInventoryRow[];
const ragRows = JSON.parse(fs.readFileSync(ragPath, "utf8")) as RawRagRow[];

const results: UploadResult[] = [];
const knowledgeDocuments = ragRows.map((row, index) => ({
  id: makeKnowledgeId(row, index),
  source: row.source,
  heading: row.heading,
  content: row.text_excerpt,
  payload: row
}));

results.push(
  await upsert(
    "vehicles",
    await buildVehicleRows([...seedVehicles, ...inventory.map(normalizeFlowrydVehicle)])
  )
);

results.push(
  await upsert(
    "knowledge_documents",
    knowledgeDocuments
  )
);

results.push(await upsert("knowledge_chunks", await buildKnowledgeChunks(knowledgeDocuments)));

console.table(results);

async function upsert(table: string, rows: unknown[]): Promise<UploadResult> {
  const chunks = chunk(rows, 100);
  let inserted = 0;

  for (const rowsChunk of chunks) {
    const response = await fetch(`${supabaseUrl!.replace(/\/$/, "")}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey!,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(rowsChunk)
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 404 && body.includes("PGRST205")) {
        throw new Error(
          `Supabase table missing for ${table}. Apply supabase/migrations in order before running this upload. ${body}`
        );
      }
      throw new Error(`Supabase upsert failed for ${table}: ${response.status} ${body}`);
    }

    inserted += rowsChunk.length;
  }

  return {
    table,
    attempted: rows.length,
    inserted
  };
}

function makeKnowledgeId(row: RawRagRow, index: number) {
  return `flowryd-rag:${row.source}:${slug(`${index}-${row.heading}`)}`.slice(0, 220);
}

async function buildVehicleRows(vehicles: Awaited<ReturnType<typeof normalizeFlowrydVehicle>>[]) {
  const rows = [];
  for (const vehicle of vehicles) {
    let embedding = await createDocumentEmbedding(buildVehicleEmbeddingText(vehicle), vehicleTitle(vehicle));
    if (!embedding) {
      embedding = await createDocumentEmbedding(buildVehicleEmbeddingText(vehicle), vehicleTitle(vehicle));
    }
    rows.push({
      id: vehicle.id,
      payload: vehicle,
      embedding: embedding ? `[${embedding.join(",")}]` : null
    });
  }
  return rows;
}

async function buildKnowledgeChunks(
  documents: Array<{ id: string; source: string; heading: string; content: string; payload: RawRagRow }>
): Promise<KnowledgeChunkUploadRow[]> {
  const chunks: KnowledgeChunkUploadRow[] = [];
  for (const document of documents) {
    const parts = chunkText(document.content);
    for (const [index, content] of parts.entries()) {
      const embedding = await createDocumentEmbedding(content, document.heading);
      chunks.push({
        id: `${document.id}:chunk:${index}`,
        document_id: document.id,
        topic: inferTopic(document.source, document.heading, content),
        source: document.source,
        language: inferLanguage(`${document.heading} ${content}`),
        heading: document.heading,
        content,
        content_hash: sha256(content),
        embedding: embedding ? `[${embedding.join(",")}]` : null,
        metadata: {
          sourceRow: document.payload,
          chunkIndex: index,
          embeddingModel: env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2",
          embeddingDimensions: embeddingDimensions()
        }
      });
    }
  }
  return chunks;
}

function chunkText(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 1200) return [normalized];
  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += 900) {
    chunks.push(normalized.slice(index, index + 1200).trim());
  }
  return chunks;
}

function inferTopic(source: string, heading: string, content: string) {
  const text = `${source} ${heading} ${content}`.toLowerCase();
  if (/(ladestellen|charging|ladeinfrastruktur|e-control|public charging)/i.test(text)) return "charging_network";
  if (/(förder|foerder|incentive|bonus|umweltfoerderung|eride)/i.test(text)) return "austrian_incentive";
  if (/(spec|technical|technisch|battery|reichweite|efficiency|verbrauch|wltp)/i.test(text)) return "technical_spec";
  if (/(review|test|comfort|premium|road trip|fahrbericht|qualität|qualitaet)/i.test(text)) return "review";
  return "general";
}

function inferLanguage(value: string): "de" | "en" {
  return /[äöüß]/i.test(value) || /(förder|ladestellen|reichweite|verbrauch|öffentlich|für|und|der|die|das)/i.test(value)
    ? "de"
    : "en";
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function chunk<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
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
