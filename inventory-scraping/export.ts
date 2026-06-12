// Per-source output writers: one JSON and one CSV file per source under
// inventory-scraping/output/{json,csv}/. A zero-row source still gets a CSV
// carrying the full header row (so the column contract is visible) and an
// empty JSON array.
import fs from "node:fs";
import path from "node:path";
import type { Vehicle } from "../lib/types.ts";
import type { FetchRecord } from "./fetcher-common.ts";
import type { RagRecord, RawListing } from "./types.ts";

// Canonical, stable column order for vehicle CSVs.
const VEHICLE_COLUMNS = [
  "id",
  "source",
  "sourceId",
  "make",
  "model",
  "trim",
  "title",
  "condition",
  "priceEUR",
  "monthlyLeaseEUR",
  "year",
  "firstRegistration",
  "mileageKm",
  "bodyType",
  "rangeKm",
  "batteryKwh",
  "efficiencyKwhPer100Km",
  "batterySoH",
  "powerKw",
  "drivetrain",
  "seats",
  "cargoLiters",
  "location",
  "sellerName",
  "sellerType",
  "vin",
  "listingUrl",
  "imageUrl",
  "features",
  "crawledAt",
  "dedupeKey"
] as const;

const RAG_COLUMNS = ["source", "sourceUrl", "heading", "text"] as const;

export type SourceOutput = {
  sourceId: string;
  recordType: "inventory" | "context";
  rowCount: number;
  jsonPath: string;
  csvPath: string;
  rawJsonPath?: string;
  durationMs?: number;
  error?: string;
};

export type Crawl4AiExport = {
  manifestPath: string;
  htmlDir: string;
  pages: Array<FetchRecord & { htmlPath?: string }>;
};

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  let text: string;
  if (Array.isArray(value)) text = value.join("|");
  else if (typeof value === "boolean") text = value ? "true" : "false";
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filePath: string, columns: readonly string[], rows: Array<Record<string, unknown>>) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function outputPaths(outputDir: string, sourceId: string) {
  const jsonDir = path.join(outputDir, "json");
  const csvDir = path.join(outputDir, "csv");
  fs.mkdirSync(jsonDir, { recursive: true });
  fs.mkdirSync(csvDir, { recursive: true });
  return {
    jsonPath: path.join(jsonDir, `${sourceId}.json`),
    csvPath: path.join(csvDir, `${sourceId}.csv`)
  };
}

function vehicleToCsvRow(vehicle: Vehicle): Record<string, unknown> {
  const raw = vehicle.raw as { sourceId?: string } | undefined;
  return {
    ...vehicle,
    sourceId: raw?.sourceId ?? vehicle.source,
    imageUrl: vehicle.images[0] ?? null
  };
}

function rawOutputPaths(outputDir: string, sourceId: string) {
  const rawDir = path.join(outputDir, "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  return { rawJsonPath: path.join(rawDir, `${sourceId}.json`) };
}

export function writeRawListingOutputs(outputDir: string, sourceId: string, listings: RawListing[]) {
  const { rawJsonPath } = rawOutputPaths(outputDir, sourceId);
  fs.writeFileSync(rawJsonPath, `${JSON.stringify(listings, null, 2)}\n`, "utf8");
  return rawJsonPath;
}

export function writeVehicleOutputs(
  outputDir: string,
  sourceId: string,
  vehicles: Vehicle[],
  rawListings: RawListing[] = []
): SourceOutput {
  const { jsonPath, csvPath } = outputPaths(outputDir, sourceId);
  fs.writeFileSync(jsonPath, `${JSON.stringify(vehicles, null, 2)}\n`, "utf8");
  writeCsv(csvPath, VEHICLE_COLUMNS, vehicles.map(vehicleToCsvRow));
  const rawJsonPath = rawListings.length ? writeRawListingOutputs(outputDir, sourceId, rawListings) : undefined;
  return { sourceId, recordType: "inventory", rowCount: vehicles.length, jsonPath, csvPath, rawJsonPath };
}

export function writeCrawl4AiOutputs(outputDir: string, fetchLog: FetchRecord[]): Crawl4AiExport | null {
  const crawl4aiRecords = fetchLog.filter((record) => record.fetcher === "crawl4ai");
  if (!crawl4aiRecords.length) return null;

  const crawl4aiDir = path.join(outputDir, "crawl4ai");
  const htmlDir = path.join(crawl4aiDir, "html");
  fs.mkdirSync(htmlDir, { recursive: true });

  const pages = crawl4aiRecords.map((record) => {
    if (!record.cacheFile || !fs.existsSync(record.cacheFile)) return record;
    const htmlPath = path.join(htmlDir, path.basename(record.cacheFile));
    fs.copyFileSync(record.cacheFile, htmlPath);
    return { ...record, htmlPath };
  });

  const manifestPath = path.join(crawl4aiDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify({ pages }, null, 2)}\n`, "utf8");
  return { manifestPath, htmlDir, pages };
}

export function writeContextOutputs(outputDir: string, sourceId: string, records: RagRecord[]): SourceOutput {
  const { jsonPath, csvPath } = outputPaths(outputDir, sourceId);
  fs.writeFileSync(jsonPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  writeCsv(csvPath, RAG_COLUMNS, records as unknown as Array<Record<string, unknown>>);
  return { sourceId, recordType: "context", rowCount: records.length, jsonPath, csvPath };
}

export function printRunSummary(outputs: SourceOutput[], totalMs: number) {
  console.log("");
  console.log("──────────────────────────── RUN SUMMARY ────────────────────────────");
  console.table(
    outputs.map((output) => ({
      source: output.sourceId,
      type: output.recordType,
      rows: output.rowCount,
      time: `${((output.durationMs ?? 0) / 1000).toFixed(1)}s`,
      status: output.error ? `ERROR: ${output.error.slice(0, 80)}` : "ok"
    }))
  );
  const totalRows = outputs.reduce((acc, output) => acc + output.rowCount, 0);
  console.log(`Total: ${outputs.length} sources · ${totalRows} rows · ${(totalMs / 1000).toFixed(1)}s`);
}
