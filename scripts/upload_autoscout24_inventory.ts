import fs from "node:fs";
import path from "node:path";
import {
  prepareAutoscout24VehicleForUpload,
  type Autoscout24InventoryRow
} from "../lib/inventory/autoscout24-payload.ts";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";
import type { Vehicle } from "../lib/types.ts";

type UploadOptions = {
  filePath: string;
  dryRun: boolean;
  limit: number | null;
  batchSize: number;
};

type VehicleUploadRow = {
  id: string;
  payload: Vehicle;
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
const options = parseArgs(process.argv.slice(2));
const supabase = getSupabaseRestConfig();
if (!supabase && !options.dryRun) {
  throw new Error(
    "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, or pass --dry-run."
  );
}

const sourceRows = JSON.parse(fs.readFileSync(options.filePath, "utf8")) as Autoscout24InventoryRow[];
const dedupedRows = dedupeInventoryRows(sourceRows);
const selectedRows = options.limit === null ? dedupedRows : dedupedRows.slice(0, options.limit);
const vehicles = selectedRows.map(prepareAutoscout24VehicleForUpload);

console.log(
  `AutoScout24 upload: file=${options.filePath}, rows=${vehicles.length}/${sourceRows.length} (${dedupedRows.length} unique), dryRun=${options.dryRun}`
);

if (options.dryRun) {
  const sample = vehicles[0];
  console.log("Sample vehicle id:", sample?.id);
  console.log("Sample source:", sample?.source);
  console.log("Sample make/model:", sample?.make, sample?.model);
  process.exit(0);
}

const uploadRows = buildVehicleRows(vehicles);
const result = await upsertVehicles(uploadRows, options.batchSize);
console.table([result]);

function dedupeInventoryRows(rows: Autoscout24InventoryRow[]): Autoscout24InventoryRow[] {
  const byId = new Map<string, Autoscout24InventoryRow>();

  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing || inventoryRowTimestamp(row) >= inventoryRowTimestamp(existing)) {
      byId.set(row.id, row);
    }
  }

  return [...byId.values()];
}

function inventoryRowTimestamp(row: Autoscout24InventoryRow) {
  const value = row.sourceUpdatedAt ?? row.crawledAt ?? "";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function buildVehicleRows(normalizedVehicles: Vehicle[]): VehicleUploadRow[] {
  return normalizedVehicles.map((vehicle) => ({
    id: vehicle.id,
    payload: vehicle
  }));
}

async function upsertVehicles(rows: VehicleUploadRow[], batchSize: number): Promise<UploadResult> {
  const currentSupabase = getSupabaseRestConfig();
  if (!currentSupabase) throw new Error("Supabase config is missing.");

  let inserted = 0;
  for (const rowsChunk of chunk(rows, batchSize)) {
    const response = await fetch(`${currentSupabase.url}/rest/v1/vehicles?on_conflict=id`, {
      method: "POST",
      headers: {
        ...currentSupabase.headers,
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(rowsChunk)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase upsert failed for vehicles: ${response.status} ${body}`);
    }
    inserted += rowsChunk.length;
  }

  return { table: "vehicles", attempted: rows.length, inserted };
}

function parseArgs(args: string[]): UploadOptions {
  const optionsValue: UploadOptions = {
    filePath: path.join(root, "inventory-scraping", "output", "autoscout24.json"),
    dryRun: false,
    limit: null,
    batchSize: 50
  };

  for (const arg of args) {
    if (arg === "--dry-run") optionsValue.dryRun = true;
    else if (arg.startsWith("--file=")) optionsValue.filePath = path.resolve(root, arg.slice("--file=".length));
    else if (arg.startsWith("--limit=")) optionsValue.limit = positiveInteger(arg, "--limit");
    else if (arg.startsWith("--batch-size=")) optionsValue.batchSize = positiveInteger(arg, "--batch-size");
  }

  if (!fs.existsSync(optionsValue.filePath)) {
    throw new Error(`Input file not found: ${optionsValue.filePath}`);
  }

  return optionsValue;
}

function positiveInteger(arg: string, name: string) {
  const value = Number(arg.slice(name.length + 1));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
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
