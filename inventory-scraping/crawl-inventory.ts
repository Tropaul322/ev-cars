import fs from "node:fs";
import path from "node:path";
import { createDocumentEmbedding, embeddingDimensions } from "../lib/embeddings.ts";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";
import type { Vehicle } from "../lib/types.ts";
import { buildVehicleEmbeddingText, vehicleTitle } from "../lib/vehicle-embedding-text.ts";
import { inventorySources, selectSources } from "./config.ts";
import {
  printRunSummary,
  writeContextOutputs,
  writeCrawl4AiOutputs,
  writeVehicleOutputs,
  type SourceOutput
} from "./export.ts";
import { drainFetchLog } from "./fetcher-common.ts";
import { extractTitle, sha256 } from "./html.ts";
import { createInventoryFetcher } from "./create-fetcher.ts";
import { cacheFilePath } from "./fetcher-common.ts";
import { assertSourcePermitted, inventoryParserFor, parseRagPage } from "./parsers/index.ts";
import { normalizeInventoryListing } from "./normalize-listing.ts";
import type { ContextPage, CrawlOptions, CrawlSummary, InventorySourceConfig, RagRecord, RawListing } from "./types.ts";

type VehicleUploadRow = {
  id: string;
  payload: Vehicle;
  embedding: string | null;
};

type ExistingDedupeRow = {
  id: string;
  dedupe_key: string | null;
};

const root = process.cwd();
const defaultSourceIds = ["autoscout24_at_ev_all"];
const env = loadEnv(path.join(root, ".env.local"));
for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string") process.env[key] = value;
}

const options = parseArgs(process.argv.slice(2));
if (env.FLOWRYD_SKIP_EMBEDDINGS === "1" || options.skipEmbeddings) {
  process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";
}

console.log(
  `Crawl config: sources=${options.allSources ? "all" : [...options.sourceIds].join(",")}, maxListingsPerSource=${options.maxListingsPerSource}, fetcher=${options.fetcher}, outputOnly=${options.skipDb}, embeddings=${!options.skipEmbeddings}, mode=${options.offline ? "OFFLINE (cached HTML)" : "LIVE"}`
);

if (options.listSources) {
  for (const source of inventorySources) {
    console.log(`${source.id} | ${source.kind} | ${source.market} | ${source.url}`);
  }
  process.exit(0);
}

const selectedSources = options.allSources ? inventorySources : selectSources(options.sourceIds);
if (!selectedSources.length) {
  throw new Error("No inventory sources selected. Run with --list-sources to see valid source ids.");
}

const outputDir = path.join(root, "inventory-scraping", "output");
fs.mkdirSync(outputDir, { recursive: true });

const fetcher = createInventoryFetcher(options.fetcher, options.offline);
const crawledAt = new Date().toISOString();
const rawListings: RawListing[] = [];
const vehicles: Vehicle[] = [];
const contextPages: ContextPage[] = [];
const failures: CrawlSummary["failures"] = [];
const seenDedupeKeys = new Map<string, string>();
const existingDedupeIds = await loadExistingDedupeIds();
const vehiclesBySource = new Map<string, Vehicle[]>();
const rawListingsBySource = new Map<string, RawListing[]>();
const contextRecordsBySource = new Map<string, RagRecord[]>();
const sourceDurations = new Map<string, number>();
const runStart = Date.now();
let duplicateListingsSkipped = 0;

for (const source of selectedSources) {
  const sourceStart = Date.now();
  try {
    if (source.kind === "context") {
      if (source.parser !== "rag_page") {
        throw new Error(`${source.id} is missing parser: "rag_page"`);
      }
      console.log(`Scraping context source ${source.id}...`);
      const html = await fetcher.fetchHtml(source.url, {
        cacheFile: cacheFilePath(`${source.id}.html`),
        waitFor: source.waitFor ?? null
      });
      const records = parseRagPage(source.id, source.url, html);
      contextRecordsBySource.set(source.id, records);
      contextPages.push(ragRecordsToContextPage(source, records, html));
      console.log(`  extracted ${records.length} heading/text record(s) for ${source.id}`);
      await delay(options.requestDelayMs);
      continue;
    }

    const structuredParser = inventoryParserFor(source);
    if (!structuredParser) {
      throw new Error(`${source.id} is missing a structured parser`);
    }

    assertSourcePermitted(source);
    const scrapeAllPages = source.parser === "willhaben" && !options.explicitMaxListings;
    console.log(
      scrapeAllPages
        ? `Scraping ${source.id} via "${source.parser}" parser (all pages until exhausted)...`
        : `Scraping ${source.id} via "${source.parser}" parser (target ${options.maxListingsPerSource} listings)...`
    );
    const parsedListings = await structuredParser(source, fetcher, {
      maxRows: scrapeAllPages ? Number.MAX_SAFE_INTEGER : options.maxListingsPerSource,
      crawledAt
    });
    for (const rawListing of parsedListings) registerListing(source, rawListing);
    const kept = vehiclesBySource.get(source.id)?.length ?? 0;
    if (scrapeAllPages) {
      console.log(`  ${source.id} finished with ${kept} rows across all pages`);
    } else if (kept < options.maxListingsPerSource) {
      console.log(`  ${source.id} yielded ${kept}/${options.maxListingsPerSource} rows — source does not expose more`);
    }
    await delay(options.requestDelayMs);
  } catch (error) {
    failures.push({
      sourceId: source.id,
      url: source.url,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    sourceDurations.set(source.id, Date.now() - sourceStart);
  }
}

writeJson(path.join(outputDir, "raw-listings.json"), rawListings);
writeJson(path.join(outputDir, "vehicles.json"), vehicles);
writeJson(path.join(outputDir, "context-pages.json"), contextPages);

// Per-source output files: output/json/{sourceId}.json + output/csv/{sourceId}.csv.
const sourceOutputs: SourceOutput[] = selectedSources.map((source) => {
  const output =
    source.kind === "context"
      ? writeContextOutputs(outputDir, source.id, contextRecordsBySource.get(source.id) ?? [])
      : writeVehicleOutputs(
          outputDir,
          source.id,
          vehiclesBySource.get(source.id) ?? [],
          rawListingsBySource.get(source.id) ?? []
        );
  output.durationMs = sourceDurations.get(source.id);
  output.error = failures.find((failure) => failure.sourceId === source.id)?.error;
  return output;
});

const fetchLog = drainFetchLog();
const crawl4aiExport = options.fetcher === "crawl4ai" ? writeCrawl4AiOutputs(outputDir, fetchLog) : null;
if (fetchLog.length) {
  writeJson(path.join(outputDir, "fetch-log.json"), fetchLog);
}

writeJson(path.join(outputDir, "summary.json"), {
  crawledAt,
  mode: options.offline ? "offline" : "live",
  fetcher: options.fetcher,
  maxListingsPerSource: options.maxListingsPerSource,
  duplicateListingsSkipped,
  fetchCount: fetchLog.length,
  crawl4aiExport,
  sources: sourceOutputs
});
printRunSummary(sourceOutputs, Date.now() - runStart);
if (crawl4aiExport) {
  console.log(`Crawl4AI scrape export: ${crawl4aiExport.manifestPath} (${crawl4aiExport.pages.length} page(s))`);
}

const summary: CrawlSummary & {
  outputDir: string;
  embeddingDimensions: number;
  embeddingsEnabled: boolean;
} = {
  crawledAt,
  inventorySourcesAttempted: selectedSources.filter((source) => source.kind === "inventory").length,
  contextSourcesAttempted: selectedSources.filter((source) => source.kind === "context").length,
  rawListingsFound: rawListings.length,
  vehiclesNormalized: vehicles.length,
  duplicateListingsSkipped,
  contextPagesScraped: contextPages.length,
  failures,
  outputDir,
  embeddingDimensions: embeddingDimensions(),
  embeddingsEnabled: process.env.FLOWRYD_DISABLE_EMBEDDINGS !== "1"
};

writeJson(path.join(outputDir, "latest.json"), {
  ...summary,
  vehicles,
  contextPages,
  failures
});

if (options.dryRun || options.skipDb) {
  console.table([
    { table: "vehicles", attempted: vehicles.length, inserted: 0 },
    { table: "knowledge_documents", attempted: contextPages.length, inserted: 0 }
  ]);
  console.log(`Inventory crawl output: ${outputDir}`);
  process.exit(0);
}

const supabase = getSupabaseRestConfig();
if (!supabase) {
  throw new Error(
    "Missing Supabase credentials. Set SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or run with --skip-db."
  );
}

const results = [
  await upsert("vehicles", await buildVehicleRows(vehicles)),
  await upsert("knowledge_documents", contextPages.map(toKnowledgeDocumentRow))
];

console.table(results);
console.log(`Inventory crawl output: ${outputDir}`);
if (failures.length) console.warn(`Completed with ${failures.length} scrape failure(s).`);

// Normalize a raw listing, dedupe it against this run and the database, and
// record it both globally and per source.
function registerListing(source: InventorySourceConfig, rawListing: RawListing) {
  const vehicle = normalizeInventoryListing(rawListing);
  const existingId = existingDedupeIds.get(vehicle.dedupeKey ?? "");
  const seenId = seenDedupeKeys.get(vehicle.dedupeKey ?? "");

  if ((seenId && seenId !== vehicle.id) || (existingId && existingId !== vehicle.id)) {
    duplicateListingsSkipped += 1;
    return;
  }

  seenDedupeKeys.set(vehicle.dedupeKey ?? vehicle.id, vehicle.id);
  rawListings.push(rawListing);
  vehicles.push(vehicle);
  const perSource = vehiclesBySource.get(source.id) ?? [];
  perSource.push(vehicle);
  vehiclesBySource.set(source.id, perSource);
  const perSourceRaw = rawListingsBySource.get(source.id) ?? [];
  perSourceRaw.push(rawListing);
  rawListingsBySource.set(source.id, perSourceRaw);
}

function ragRecordsToContextPage(source: InventorySourceConfig, records: RagRecord[], html: string): ContextPage {
  const content = normalizeContent(
    records.map((record) => (record.heading ? `${record.heading}\n${record.text}` : record.text)).join("\n\n")
  );
  return {
    sourceId: source.id,
    name: source.name,
    url: source.url,
    kind: "context",
    market: source.market,
    crawledAt,
    title: records[0]?.heading ?? extractTitle(html),
    content,
    htmlHash: sha256(html),
    notes: source.notes
  };
}

async function buildVehicleRows(normalizedVehicles: Vehicle[]): Promise<VehicleUploadRow[]> {
  const rows: VehicleUploadRow[] = [];
  for (const vehicle of normalizedVehicles) {
    const embedding = options.skipEmbeddings
      ? null
      : await createDocumentEmbedding(buildVehicleEmbeddingText(vehicle), vehicleTitle(vehicle));
    rows.push({
      id: vehicle.id,
      payload: vehicle,
      embedding: embedding ? `[${embedding.join(",")}]` : null
    });
  }
  return rows;
}

async function upsert(table: "vehicles" | "knowledge_documents", rows: unknown[]) {
  if (!rows.length) return { table, attempted: 0, inserted: 0 };
  const currentSupabase = getSupabaseRestConfig();
  if (!currentSupabase) throw new Error("Supabase config is missing.");

  let inserted = 0;
  for (const rowsChunk of chunk(rows, 50)) {
    const response = await fetch(`${currentSupabase.url}/rest/v1/${table}?on_conflict=id`, {
      method: "POST",
      headers: {
        ...currentSupabase.headers,
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(rowsChunk)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase upsert failed for ${table}: ${response.status} ${body}`);
    }
    inserted += rowsChunk.length;
  }
  return { table, attempted: rows.length, inserted };
}

async function loadExistingDedupeIds() {
  const currentSupabase = getSupabaseRestConfig();
  const result = new Map<string, string>();
  if (!currentSupabase || options.skipDb || options.dryRun) return result;

  const response = await fetch(`${currentSupabase.url}/rest/v1/vehicles?select=id,dedupe_key&dedupe_key=not.is.null&limit=5000`, {
    headers: currentSupabase.headers
  }).catch(() => null);

  if (!response?.ok) return result;
  const rows = (await response.json().catch(() => [])) as ExistingDedupeRow[];
  for (const row of rows) {
    if (row.dedupe_key) result.set(row.dedupe_key, row.id);
  }
  return result;
}

function toKnowledgeDocumentRow(page: ContextPage) {
  return {
    id: `inventory-context:${page.sourceId}`,
    source: page.sourceId,
    heading: page.title ?? page.name,
    content: page.content,
    payload: {
      kind: "inventory_context",
      sourceId: page.sourceId,
      sourceName: page.name,
      sourceUrl: page.url,
      market: page.market,
      crawledAt: page.crawledAt,
      contentHash: sha256(page.content),
      htmlHash: page.htmlHash,
      notes: page.notes
    }
  };
}

function normalizeContent(content: string) {
  return content.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(args: string[]): CrawlOptions & { allSources: boolean; uploadDb: boolean } {
  const optionsValue: CrawlOptions & { allSources: boolean; uploadDb: boolean } = {
    dryRun: false,
    skipDb: true,
    offline: false,
    fetcher: "scrapingbee",
    explicitMaxListings: false,
    listSources: false,
    sourceIds: new Set(defaultSourceIds),
    maxListingsPerSource: 500,
    maxPagesPerSource: 30,
    requestDelayMs: 750,
    skipEmbeddings: true,
    allSources: false,
    uploadDb: false
  };

  let explicitSources = false;
  let explicitMaxListings = false;

  for (const arg of args) {
    if (arg === "--dry-run") optionsValue.dryRun = true;
    else if (arg === "--skip-db") optionsValue.skipDb = true;
    else if (arg === "--offline") optionsValue.offline = true;
    else if (arg === "--fetcher=crawl4ai") optionsValue.fetcher = "crawl4ai";
    else if (arg === "--fetcher=scrapingbee") optionsValue.fetcher = "scrapingbee";
    else if (arg === "--upload-db") optionsValue.uploadDb = true;
    else if (arg === "--all-sources") optionsValue.allSources = true;
    else if (arg === "--list-sources") optionsValue.listSources = true;
    else if (arg === "--skip-embeddings") optionsValue.skipEmbeddings = true;
    else if (arg === "--with-embeddings") optionsValue.skipEmbeddings = false;
    else if (arg.startsWith("--source=")) {
      if (!explicitSources) {
        optionsValue.sourceIds.clear();
        explicitSources = true;
      }
      for (const sourceId of arg.slice("--source=".length).split(",")) {
        if (sourceId.trim()) optionsValue.sourceIds.add(sourceId.trim());
      }
    } else if (arg.startsWith("--max-listings-per-source=")) {
      explicitMaxListings = true;
      optionsValue.maxListingsPerSource = positiveInteger(arg, "--max-listings-per-source");
    } else if (arg.startsWith("--max-pages-per-source=")) {
      optionsValue.maxPagesPerSource = positiveInteger(arg, "--max-pages-per-source");
    } else if (arg.startsWith("--request-delay-ms=")) {
      optionsValue.requestDelayMs = positiveInteger(arg, "--request-delay-ms");
    }
  }

  if (optionsValue.uploadDb) optionsValue.skipDb = false;
  optionsValue.explicitMaxListings = explicitMaxListings;

  return optionsValue;
}

function positiveInteger(arg: string, name: string) {
  const value = Number(arg.slice(name.length + 1));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
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
