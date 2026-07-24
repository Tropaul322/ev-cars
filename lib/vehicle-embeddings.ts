import crypto from "node:crypto";
import {
  createOpenAiClient,
  openAiConfigured,
  openAiEmbeddingDimensions,
  openAiEmbeddingModel
} from "./openai-provider.ts";
import { getSupabaseRestConfig } from "./repositories/supabase-rest.ts";
import type { Vehicle } from "./types.ts";
import { buildVehicleEmbeddingText, vehicleTitle } from "./vehicle-embedding-text.ts";

export type VehicleEmbeddingRow = {
  id: string;
  payload: Vehicle;
  embedding_model?: string | null;
  embedding_dimensions?: number | null;
  embedding_input_hash?: string | null;
};

type EmbeddingUpdateRow = {
  id: string;
  payload: Vehicle;
  embedding: string;
  embedding_model: string;
  embedding_dimensions: number;
  embedding_input_hash: string;
  embedding_updated_at: string;
};

export type EmbedVehiclesOptions = {
  force?: boolean;
  batchSize?: number;
  model?: string;
  dimensions?: number;
};

export type EmbedVehiclesResult = {
  attempted: number;
  updated: number;
  skipped: number;
  error?: string;
};

export function buildVehicleEmbeddingInput(vehicle: Vehicle) {
  const title = vehicleTitle(vehicle).trim() || "none";
  const text = buildVehicleEmbeddingText(vehicle).replace(/\s+/g, " ").trim();
  return `title: ${title} | text: ${text}`;
}

export function hashVehicleEmbeddingInput(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function embedVehicles(
  vehicles: Vehicle[],
  existingRows: VehicleEmbeddingRow[] = [],
  options: EmbedVehiclesOptions = {}
): Promise<EmbedVehiclesResult> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) {
    return { attempted: 0, updated: 0, skipped: vehicles.length, error: "Supabase is not configured." };
  }

  if (!openAiConfigured()) {
    return { attempted: 0, updated: 0, skipped: vehicles.length, error: "OpenAI is not configured." };
  }

  const model = options.model ?? openAiEmbeddingModel();
  const dimensions = options.dimensions ?? openAiEmbeddingDimensions();
  const batchSize = options.batchSize ?? 20;
  const force = options.force ?? false;
  const existingById = new Map(existingRows.map((row) => [row.id, row]));

  const inputs = vehicles.map((vehicle) => {
    const text = buildVehicleEmbeddingInput(vehicle);
    return {
      vehicle,
      text,
      hash: hashVehicleEmbeddingInput(text),
      existing: existingById.get(vehicle.id)
    };
  });

  const pending = force
    ? inputs
    : inputs.filter((input) => {
        const existing = input.existing;
        return (
          !existing ||
          existing.embedding_model !== model ||
          existing.embedding_dimensions !== dimensions ||
          existing.embedding_input_hash !== input.hash
        );
      });

  if (!pending.length) {
    return { attempted: 0, updated: 0, skipped: vehicles.length };
  }

  try {
    const result = await embedAndUpsertVehicles(pending, { model, dimensions, batchSize });
    return {
      attempted: pending.length,
      updated: result.updated,
      skipped: vehicles.length - pending.length
    };
  } catch (error) {
    return {
      attempted: pending.length,
      updated: 0,
      skipped: vehicles.length - pending.length,
      error: error instanceof Error ? error.message : "Embedding failed."
    };
  }
}

export async function fetchVehicleEmbeddingRows(ids: string[]): Promise<VehicleEmbeddingRow[]> {
  const supabase = getSupabaseRestConfig();
  if (!supabase || ids.length === 0) return [];

  const params = new URLSearchParams({
    select: "id,payload,embedding_model,embedding_dimensions,embedding_input_hash",
    id: `in.(${ids.join(",")})`
  });

  const response = await fetch(`${supabase.url}/rest/v1/vehicles?${params}`, {
    headers: supabase.headers,
    cache: "no-store"
  });

  if (!response.ok) return [];
  return (await response.json()) as VehicleEmbeddingRow[];
}

async function embedAndUpsertVehicles(
  inputs: { vehicle: Vehicle; text: string; hash: string }[],
  options: { model: string; dimensions: number; batchSize: number }
) {
  const supabase = getSupabaseRestConfig();
  if (!supabase) throw new Error("Supabase config is missing.");
  if (!inputs.length) return { updated: 0 };

  const client = createOpenAiClient();
  let updated = 0;

  for (const inputChunk of chunk(inputs, options.batchSize)) {
    const response = await client.embeddings.create(
      {
        model: options.model,
        input: inputChunk.map((input) => input.text),
        dimensions: options.dimensions,
        encoding_format: "float"
      },
      { timeout: 30000 }
    );

    const timestamp = new Date().toISOString();
    const updateRows: EmbeddingUpdateRow[] = inputChunk.map((input, index) => {
      const embedding = response.data[index]?.embedding;
      if (!Array.isArray(embedding) || embedding.length !== options.dimensions) {
        throw new Error(`Invalid embedding returned for vehicle ${input.vehicle.id}.`);
      }
      return {
        id: input.vehicle.id,
        payload: input.vehicle,
        embedding: `[${embedding.join(",")}]`,
        embedding_model: options.model,
        embedding_dimensions: options.dimensions,
        embedding_input_hash: input.hash,
        embedding_updated_at: timestamp
      };
    });

    await upsertEmbeddingRows(updateRows);
    updated += updateRows.length;
  }

  return { updated };
}

async function upsertEmbeddingRows(rows: EmbeddingUpdateRow[]) {
  const supabase = getSupabaseRestConfig();
  if (!supabase) throw new Error("Supabase config is missing.");

  const response = await fetch(`${supabase.url}/rest/v1/vehicles?on_conflict=id`, {
    method: "POST",
    headers: {
      ...supabase.headers,
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase upsert failed for vehicle embeddings: ${response.status} ${body}`);
  }
}

function chunk<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
