import fs from "node:fs";
import path from "node:path";
import { allVehicles } from "../lib/data/all-vehicles.ts";
import {
  openAiConfigured,
  openAiEmbeddingDimensions,
  openAiEmbeddingModel
} from "../lib/openai-provider.ts";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";
import type { Vehicle } from "../lib/types.ts";
import {
  buildVehicleEmbeddingInput,
  embedVehicles,
  fetchVehicleEmbeddingRows,
  hashVehicleEmbeddingInput,
  type VehicleEmbeddingRow
} from "../lib/vehicle-embeddings.ts";

type EmbedVehiclesOptions = {
  dryRun: boolean;
  force: boolean;
  fromSupabase: boolean;
  limit: number | null;
  batchSize: number;
  fetchBatchSize: number;
  model: string;
  dimensions: number;
};

const root = process.cwd();
const env = loadEnv(path.join(root, ".env.local"));
for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string") process.env[key] = value;
}

const options = parseArgs(process.argv.slice(2));
const supabase = getSupabaseRestConfig();

if (!options.dryRun && !supabase) {
  throw new Error(
    "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, or pass --dry-run."
  );
}

if (!options.dryRun && !openAiConfigured()) {
  throw new Error("Missing OPENAI_API_KEY. Set it in .env.local or pass --dry-run.");
}

const rows =
  supabase && (!options.dryRun || options.fromSupabase)
    ? await fetchVehicleRows(options)
    : localVehicleRows();
const uniqueRows = dedupeVehicleRows(rows);
const selectedRows = options.limit === null ? uniqueRows : uniqueRows.slice(0, options.limit);
const embeddingInputs = selectedRows.map((row) => {
  const text = buildVehicleEmbeddingInput(row.payload);
  return {
    row,
    text,
    hash: hashVehicleEmbeddingInput(text)
  };
});
const pendingInputs = options.force
  ? embeddingInputs
  : embeddingInputs.filter(
      (input) =>
        input.row.embedding_model !== options.model ||
        input.row.embedding_dimensions !== options.dimensions ||
        input.row.embedding_input_hash !== input.hash
    );

console.log(
  `Vehicle embeddings: rows=${selectedRows.length}/${uniqueRows.length}, pending=${pendingInputs.length}, duplicatesSkipped=${rows.length - uniqueRows.length}, model=${options.model}, dimensions=${options.dimensions}, batchSize=${options.batchSize}, dryRun=${options.dryRun}, force=${options.force}`
);

printEstimate(pendingInputs.map((input) => input.text));

if (options.dryRun) {
  const sample = pendingInputs[0] ?? embeddingInputs[0];
  console.log("Sample vehicle id:", sample?.row.id ?? "(none)");
  console.log("Sample input:", sample?.text.slice(0, 320) ?? "(none)");
  process.exit(0);
}

const vehicles = pendingInputs.map((input) => input.row.payload);
const existingRows = pendingInputs.map((input) => input.row);
const result = await embedVehicles(vehicles, existingRows, {
  force: options.force,
  batchSize: options.batchSize,
  model: options.model,
  dimensions: options.dimensions
});
console.table([result]);

async function fetchVehicleRows(optionsValue: EmbedVehiclesOptions): Promise<VehicleEmbeddingRow[]> {
  const currentSupabase = getSupabaseRestConfig();
  if (!currentSupabase) return [];

  const rows: VehicleEmbeddingRow[] = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      select: "id,payload,embedding_model,embedding_dimensions,embedding_input_hash",
      market: "eq.AT",
      available: "eq.true",
      order: "id.asc",
      limit: String(optionsValue.fetchBatchSize),
      offset: String(offset)
    });

    const response = await fetch(`${currentSupabase.url}/rest/v1/vehicles?${params}`, {
      headers: currentSupabase.headers
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to fetch vehicles for embedding: ${response.status} ${body}. Run the latest Supabase migration if embedding metadata columns are missing.`
      );
    }

    const page = (await response.json()) as VehicleEmbeddingRow[];
    rows.push(...page);
    if (page.length < optionsValue.fetchBatchSize) break;
    offset += page.length;
    if (optionsValue.limit !== null && rows.length >= optionsValue.limit) break;
  }

  return dedupeVehicleRows(rows.filter((row) => isVehicle(row.payload)));
}

function localVehicleRows(): VehicleEmbeddingRow[] {
  return allVehicles.map((vehicle) => ({
    id: vehicle.id,
    payload: vehicle
  }));
}

function dedupeVehicleRows(rows: VehicleEmbeddingRow[]) {
  const byId = new Map<string, VehicleEmbeddingRow>();

  for (const row of rows) {
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
    }
  }

  return [...byId.values()];
}

function printEstimate(texts: string[]) {
  const estimatedTokens = texts.reduce((total, text) => total + Math.ceil(text.length / 4), 0);
  const estimatedCostUsd = (estimatedTokens / 1_000_000) * (options.model === "text-embedding-3-large" ? 0.13 : 0.02);
  console.log(`Estimated input tokens=${estimatedTokens.toLocaleString("en-US")}, estimated OpenAI cost=$${estimatedCostUsd.toFixed(4)}`);
}

function parseArgs(args: string[]): EmbedVehiclesOptions {
  const optionsValue: EmbedVehiclesOptions = {
    dryRun: false,
    force: false,
    fromSupabase: false,
    limit: null,
    batchSize: 64,
    fetchBatchSize: 1000,
    model: openAiEmbeddingModel(),
    dimensions: openAiEmbeddingDimensions()
  };

  for (const arg of args) {
    if (arg === "--dry-run") optionsValue.dryRun = true;
    else if (arg === "--force") optionsValue.force = true;
    else if (arg === "--from-supabase") optionsValue.fromSupabase = true;
    else if (arg.startsWith("--limit=")) optionsValue.limit = positiveInteger(arg, "--limit");
    else if (arg.startsWith("--batch-size=")) optionsValue.batchSize = positiveInteger(arg, "--batch-size");
    else if (arg.startsWith("--fetch-batch-size=")) optionsValue.fetchBatchSize = positiveInteger(arg, "--fetch-batch-size");
    else if (arg.startsWith("--model=")) optionsValue.model = arg.slice("--model=".length);
    else if (arg.startsWith("--dimensions=")) optionsValue.dimensions = positiveInteger(arg, "--dimensions");
  }

  return optionsValue;
}

function positiveInteger(arg: string, name: string) {
  const value = Number(arg.slice(name.length + 1));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function isVehicle(value: unknown): value is Vehicle {
  if (!value || typeof value !== "object") return false;
  const vehicle = value as Partial<Vehicle>;
  return (
    typeof vehicle.id === "string" &&
    vehicle.market === "AT" &&
    typeof vehicle.make === "string" &&
    typeof vehicle.model === "string" &&
    typeof vehicle.priceEUR === "number" &&
    typeof vehicle.rangeKm === "number" &&
    Array.isArray(vehicle.features) &&
    Array.isArray(vehicle.images)
  );
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
