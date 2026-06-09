import ragRows from "../../data/flowryd_site/rag.json" with { type: "json" };
import type { KnowledgeTopic } from "../types.ts";
import { getSupabaseRestConfig } from "./supabase-rest.ts";

type RawRagRow = {
  source: string;
  heading: string;
  text_excerpt: string;
};

export type KnowledgeDocument = {
  id: string;
  source: string;
  heading: string;
  content: string;
  topic?: KnowledgeTopic;
  language?: "de" | "en";
  sourceUrl?: string;
  similarity?: number;
  payload: unknown;
};

export type KnowledgeChunk = KnowledgeDocument & {
  documentId: string | null;
  similarity?: number;
};

type SupabaseKnowledgeDocumentRow = {
  id: string;
  source: string;
  heading: string;
  content: string;
  topic?: KnowledgeTopic;
  language?: "de" | "en";
  payload: unknown;
};

type SupabaseKnowledgeChunkRow = {
  id: string;
  document_id: string | null;
  source: string;
  topic: KnowledgeTopic;
  language: "de" | "en";
  heading: string;
  content: string;
  metadata?: unknown;
  similarity?: number;
};

const localKnowledgeDocuments = (ragRows as RawRagRow[]).map((row, index) => ({
  id: makeKnowledgeId(row, index),
  source: row.source,
  heading: row.heading,
  content: row.text_excerpt,
  topic: inferTopic(row.source, row.heading, row.text_excerpt),
  language: inferLanguage(`${row.heading} ${row.text_excerpt}`),
  sourceUrl: sourceUrlFromPayload(row),
  payload: row
}));

const localKnowledgeChunks: KnowledgeChunk[] = localKnowledgeDocuments.map((document) => ({
  ...document,
  id: `chunk:${document.id}`,
  documentId: document.id,
  payload: {
    kind: "knowledge_chunk",
    document
  }
}));

export async function listKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return localKnowledgeDocuments;

  const params = new URLSearchParams({
    select: "id,source,heading,content,payload",
    order: "updated_at.desc",
    limit: "500"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/knowledge_documents?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 300 }
    });
    if (!response.ok) return localKnowledgeDocuments;

    const rows = (await response.json()) as SupabaseKnowledgeDocumentRow[];
    const documents = rows.map(normalizeKnowledgeDocument).filter(isKnowledgeDocument);
    return documents.length ? documents : localKnowledgeDocuments;
  } catch {
    return localKnowledgeDocuments;
  }
}

export async function listKnowledgeChunks(): Promise<KnowledgeChunk[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) return localKnowledgeChunks;

  const params = new URLSearchParams({
    select: "id,document_id,source,topic,language,heading,content,metadata",
    order: "updated_at.desc",
    limit: "500"
  });

  try {
    const response = await fetch(`${supabase.url}/rest/v1/knowledge_chunks?${params}`, {
      headers: supabase.headers,
      next: { revalidate: 300 }
    });
    if (!response.ok) return localKnowledgeChunks;
    const rows = (await response.json()) as SupabaseKnowledgeChunkRow[];
    const chunks = rows.map(normalizeKnowledgeChunk).filter(isKnowledgeChunk);
    return chunks.length ? chunks : localKnowledgeChunks;
  } catch {
    return localKnowledgeChunks;
  }
}

export async function matchKnowledgeChunksByEmbedding(
  embedding: number[],
  limit = 8
): Promise<KnowledgeChunk[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase || !embedding.length) return [];

  try {
    const response = await fetch(`${supabase.url}/rest/v1/rpc/match_knowledge_chunks`, {
      method: "POST",
      headers: supabase.headers,
      body: JSON.stringify({
        query_embedding: `[${embedding.join(",")}]`,
        match_count: limit,
        min_similarity: 0
      })
    });
    if (!response.ok) return [];
    const rows = (await response.json()) as SupabaseKnowledgeChunkRow[];
    return rows.map(normalizeKnowledgeChunk).filter(isKnowledgeChunk);
  } catch {
    return [];
  }
}

function normalizeKnowledgeDocument(row: SupabaseKnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    source: row.source,
    heading: row.heading,
    content: row.content,
    topic: row.topic ?? inferTopic(row.source, row.heading, row.content),
    language: row.language ?? inferLanguage(`${row.heading} ${row.content}`),
    sourceUrl: sourceUrlFromPayload(row.payload),
    payload: row.payload
  };
}

function normalizeKnowledgeChunk(row: SupabaseKnowledgeChunkRow): KnowledgeChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    source: row.source,
    heading: row.heading,
    content: row.content,
    topic: row.topic,
    language: row.language,
    similarity: row.similarity,
    sourceUrl: sourceUrlFromPayload(row.metadata),
    payload: row.metadata ?? row
  };
}

function isKnowledgeDocument(value: unknown): value is KnowledgeDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<KnowledgeDocument>;
  return (
    typeof document.id === "string" &&
    typeof document.source === "string" &&
    typeof document.heading === "string" &&
    typeof document.content === "string"
  );
}

function isKnowledgeChunk(value: unknown): value is KnowledgeChunk {
  return isKnowledgeDocument(value) && "documentId" in value;
}

function makeKnowledgeId(row: RawRagRow, index: number) {
  return `flowryd-rag:${row.source}:${slug(`${index}-${row.heading}`)}`.slice(0, 220);
}

export function inferTopic(source: string, heading: string, content: string): KnowledgeTopic {
  const text = `${source} ${heading} ${content}`.toLowerCase();
  if (/(ladestellen|charging|ladeinfrastruktur|e-control|public charging)/i.test(text)) {
    return "charging_network";
  }
  if (/(förder|foerder|incentive|bonus|umweltfoerderung|eride)/i.test(text)) {
    return "austrian_incentive";
  }
  if (/(spec|technical|technisch|battery|reichweite|efficiency|verbrauch|wltp)/i.test(text)) {
    return "technical_spec";
  }
  if (/(review|test|comfort|premium|road trip|fahrbericht|qualität|qualitaet)/i.test(text)) {
    return "review";
  }
  return "general";
}

function inferLanguage(value: string): "de" | "en" {
  const normalized = value.toLowerCase();
  if (/[äöüß]/i.test(value) || /(förder|ladestellen|reichweite|verbrauch|öffentlich|für|und|der|die|das)/i.test(normalized)) {
    return "de";
  }
  return "en";
}

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sourceUrlFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const value = record.sourceUrl ?? record.source_url ?? record.url;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
