import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createDocumentEmbedding, embeddingDimensions } from "../lib/embeddings.ts";
import { openAiEmbeddingModel } from "../lib/openai-provider.ts";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";
import type { KnowledgeTopic } from "../lib/types.ts";

type TrustedSource = {
  id: string;
  name: string;
  publisher: string;
  url: string;
  topic: KnowledgeTopic;
  language: "de" | "en";
  trustTier: "official" | "independent_test" | "manufacturer";
  intendedUse: string[];
};

type IngestOptions = {
  dryRun: boolean;
  skipDb: boolean;
  noFirecrawl: boolean;
  firecrawlOnly: boolean;
  sourceIds: Set<string>;
  maxSources: number | null;
  listSources: boolean;
  embeddingDelayMs: number;
  embeddingRetries: number;
};

type ScrapedPage = {
  title: string | null;
  content: string;
  provider: "firecrawl" | "fetch";
  metadata: Record<string, unknown>;
};

type TrustedKnowledgeDocument = {
  id: string;
  source: string;
  heading: string;
  content: string;
  payload: {
    kind: "trusted_ev_knowledge";
    sourceId: string;
    sourceName: string;
    sourceUrl: string;
    publisher: string;
    topic: KnowledgeTopic;
    language: "de" | "en";
    trustTier: TrustedSource["trustTier"];
    intendedUse: string[];
    crawlProvider: ScrapedPage["provider"];
    crawledAt: string;
    contentHash: string;
    extracted: ReturnType<typeof extractSignals>;
    scrapeMetadata: Record<string, unknown>;
  };
};

type KnowledgeChunkUploadRow = {
  id: string;
  document_id: string;
  topic: KnowledgeTopic;
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

const trustedSources: TrustedSource[] = [
  {
    id: "adac_winter_range_2026",
    name: "ADAC winter motorway EV range test 2026",
    publisher: "ADAC",
    url: "https://www.adac.de/rund-ums-fahrzeug/elektromobilitaet/elektroauto/elektroauto-reichweite-im-winter-adac-test-2026/",
    topic: "review",
    language: "de",
    trustTier: "independent_test",
    intendedUse: ["winter_fit", "road_trip_fit", "fast_charging"]
  },
  {
    id: "adac_ecotest_ev_consumption",
    name: "ADAC EV range and consumption comparison",
    publisher: "ADAC",
    url: "https://www.adac.de/rund-ums-fahrzeug/elektromobilitaet/elektroauto/stromverbrauch-elektroautos-adac-test/",
    topic: "technical_spec",
    language: "de",
    trustTier: "independent_test",
    intendedUse: ["real_world_range", "efficiency", "road_trip_fit"]
  },
  {
    id: "klimafonds_private_emobility_2025",
    name: "Austria private e-mobility incentives 2025",
    publisher: "Klima- und Energiefonds",
    url: "https://www.klimafonds.gv.at/foerderung/emob-private-2025/",
    topic: "austrian_incentive",
    language: "de",
    trustTier: "official",
    intendedUse: ["incentive_status", "private_buyer_context", "charging_incentive"]
  },
  {
    id: "umweltfoerderung_private_charging_2025",
    name: "Austria private charging infrastructure incentive 2025",
    publisher: "Kommunalkredit Public Consulting",
    url: "https://www.umweltfoerderung.at/privatpersonen/e-ladeinfrastruktur-private-2025-eride/fahrzeuge-ladeinfrastruktur",
    topic: "austrian_incentive",
    language: "de",
    trustTier: "official",
    intendedUse: ["incentive_status", "home_charging", "apartment_charging"]
  },
  {
    id: "emove_austria_eride",
    name: "eMove Austria eRide overview",
    publisher: "eMove Austria",
    url: "https://emove-austria.gv.at/eride/",
    topic: "austrian_incentive",
    language: "de",
    trustTier: "official",
    intendedUse: ["austrian_market_context", "incentive_status", "policy_context"]
  },
  {
    id: "econtrol_charge_api_info",
    name: "E-Control charging directory API technical information",
    publisher: "E-Control",
    url: "https://www.e-control.at/ladestellenverzeichnis-technische-informationen",
    topic: "charging_network",
    language: "de",
    trustTier: "official",
    intendedUse: ["public_charging_context", "charging_api", "austrian_network"]
  },
  {
    id: "econtrol_charge_data_definitions",
    name: "E-Control charging directory data definitions",
    publisher: "E-Control",
    url: "https://www.e-control.at/ladestellenverzeichnis/daten-2025",
    topic: "charging_network",
    language: "de",
    trustTier: "official",
    intendedUse: ["public_charging_context", "connector_types", "charging_power"]
  },
  {
    id: "eafo_austria_infrastructure",
    name: "EAFO Austria charging infrastructure",
    publisher: "European Alternative Fuels Observatory",
    url: "https://alternative-fuels-observatory.ec.europa.eu/transport-mode/road/austria/infrastructure",
    topic: "charging_network",
    language: "en",
    trustTier: "official",
    intendedUse: ["charging_network_growth", "ac_dc_mix", "eu_context"]
  },
  {
    id: "eafo_data_quality_faq",
    name: "EAFO data methodology and public charging definitions",
    publisher: "European Alternative Fuels Observatory",
    url: "https://alternative-fuels-observatory.ec.europa.eu/general-information/frequently-asked-questions",
    topic: "charging_network",
    language: "en",
    trustTier: "official",
    intendedUse: ["charging_definitions", "data_quality", "public_accessibility"]
  },
  {
    id: "hyundai_ioniq5_eu_specs",
    name: "Hyundai IONIQ 5 Europe technical and charging specs",
    publisher: "Hyundai Motor Europe",
    url: "https://www.hyundai.com/eu/en/models/ioniq5/performance.html",
    topic: "technical_spec",
    language: "en",
    trustTier: "manufacturer",
    intendedUse: ["vehicle_specs", "fast_charging", "winter_fit"]
  },
  {
    id: "volkswagen_id4_at_equipment",
    name: "Volkswagen Austria ID.4 equipment and charging context",
    publisher: "Volkswagen Austria",
    url: "https://www.volkswagen.at/id4/id4/serienausstattung",
    topic: "technical_spec",
    language: "de",
    trustTier: "manufacturer",
    intendedUse: ["vehicle_specs", "family_fit", "charging"]
  }
];

const knownModels = [
  ["Audi", "A6 Avant e-tron", /\bAudi\s+A6\s+Avant\s+e-?tron\b/i],
  ["BMW", "i5 Touring", /\bBMW\s+i5\s+Touring\b/i],
  ["BYD", "Sealion 7", /\bBYD\s+Sealion\s+7\b/i],
  ["Hyundai", "IONIQ 5", /\bHyundai\s+Ioniq\s+5\b|\bIONIQ\s+5\b/i],
  ["Kia", "EV6", /\bKia\s+EV6\b|\bEV6\b/i],
  ["Mercedes-Benz", "EQE SUV", /\bMercedes(?:-Benz)?\s+EQE\s+SUV\b/i],
  ["Opel", "Grandland Electric", /\bOpel\s+Grandland\s+Electric\b/i],
  ["Polestar", "4", /\bPolestar\s+4\b/i],
  ["Porsche", "Macan", /\bPorsche\s+Macan\b/i],
  ["Skoda", "Elroq", /\b(?:Skoda|Škoda)\s+Elroq\b/i],
  ["Smart", "#5", /\bSmart\s+#?5\b/i],
  ["Tesla", "Model Y", /\bTesla\s+Model\s+Y\b/i],
  ["Volvo", "EX90", /\bVolvo\s+EX90\b/i],
  ["Volkswagen", "ID.4", /\b(?:Volkswagen|VW)\s+ID\.?4\b|\bID\.?4\b/i],
  ["Volkswagen", "ID.7", /\b(?:Volkswagen|VW)\s+ID\.?7\b|\bID\.?7\b/i]
] as const;

const root = process.cwd();
const env = loadEnv(path.join(root, ".env.local"));
for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string") process.env[key] = value;
}

const options = parseArgs(process.argv.slice(2));
if (env.FLOWRYD_SKIP_EMBEDDINGS === "1" || process.argv.includes("--skip-embeddings")) {
  process.env.FLOWRYD_DISABLE_EMBEDDINGS = "1";
}

if (options.listSources) {
  for (const source of trustedSources) {
    console.log(`${source.id} | ${source.topic} | ${source.url}`);
  }
  process.exit(0);
}

const selectedSources = selectSources(options);
if (!selectedSources.length) {
  throw new Error("No trusted sources selected. Run with --list-sources to see valid source ids.");
}

const outputDir = path.join(root, "data", "trusted_ev_knowledge");
fs.mkdirSync(outputDir, { recursive: true });

const crawledAt = new Date().toISOString();
const documents: TrustedKnowledgeDocument[] = [];
const failures: Array<{ sourceId: string; url: string; error: string }> = [];

for (const source of selectedSources) {
  try {
    console.log(`Scraping ${source.id}...`);
    const scraped = await scrapeTrustedSource(source, options);
    const content = normalizeContent(scraped.content);

    if (content.length < 250) {
      throw new Error(`Scraped content is too short (${content.length} chars).`);
    }

    documents.push(buildDocument(source, scraped, content, crawledAt));
  } catch (error) {
    failures.push({
      sourceId: source.id,
      url: source.url,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

if (!documents.length) {
  writeJson(path.join(outputDir, "latest.json"), { crawledAt, documents: [], chunks: [], failures });
  throw new Error("No trusted EV knowledge documents were scraped.");
}

const chunks = await buildKnowledgeChunks(documents);

writeJson(path.join(outputDir, "documents.json"), documents);
writeJson(path.join(outputDir, "chunks.json"), chunks);
writeJson(path.join(outputDir, "latest.json"), {
  crawledAt,
  sourcesAttempted: selectedSources.length,
  documentsScraped: documents.length,
  chunksBuilt: chunks.length,
  embeddingDimensions: embeddingDimensions(),
  embeddingsEnabled: process.env.FLOWRYD_DISABLE_EMBEDDINGS !== "1",
  failures,
  documents,
  chunks
});

if (options.dryRun || options.skipDb) {
  console.table([
    { table: "knowledge_documents", attempted: documents.length, inserted: 0 },
    { table: "knowledge_chunks", attempted: chunks.length, inserted: 0 }
  ]);
  if (failures.length) console.warn(`Completed with ${failures.length} scrape failure(s).`);
  process.exit(0);
}

const supabase = getSupabaseRestConfig();
if (!supabase) {
  throw new Error(
    "Missing Supabase credentials. Set SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
  );
}

const results = [
  await upsert("knowledge_documents", documents.map(toKnowledgeDocumentRow)),
  await upsert("knowledge_chunks", chunks)
];

console.table(results);
if (failures.length) console.warn(`Completed with ${failures.length} scrape failure(s). See data/trusted_ev_knowledge/latest.json.`);

async function scrapeTrustedSource(source: TrustedSource, ingestOptions: IngestOptions): Promise<ScrapedPage> {
  if (process.env.FIRECRAWL_API_KEY && !ingestOptions.noFirecrawl) {
    try {
      return await scrapeWithFirecrawl(source);
    } catch (error) {
      if (ingestOptions.firecrawlOnly) throw error;
      console.warn(`Firecrawl failed for ${source.id}; falling back to fetch.`);
    }
  }

  return scrapeWithFetch(source);
}

async function scrapeWithFirecrawl(source: TrustedSource): Promise<ScrapedPage> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured.");

  const endpoint = process.env.FIRECRAWL_API_URL ?? "https://api.firecrawl.dev/v1/scrape";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      url: source.url,
      formats: ["markdown", "html"],
      onlyMainContent: true,
      waitFor: 1000,
      timeout: 30000
    }),
    signal: AbortSignal.timeout(45000)
  });

  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    error?: string;
    data?: {
      markdown?: string;
      html?: string;
      rawHtml?: string;
      title?: string;
      metadata?: Record<string, unknown>;
    };
  } | null;

  if (!response.ok || !body?.success || !body.data) {
    throw new Error(body?.error ?? `Firecrawl returned ${response.status}`);
  }

  const metadata = body.data.metadata ?? {};
  const title = stringValue(metadata.title) ?? body.data.title ?? source.name;
  const content = body.data.markdown ?? htmlToText(body.data.html ?? body.data.rawHtml ?? "");

  return {
    title,
    content,
    provider: "firecrawl",
    metadata
  };
}

async function scrapeWithFetch(source: TrustedSource): Promise<ScrapedPage> {
  const response = await fetch(source.url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": "FlowRydEVKnowledgeBot/0.1 (+https://flowryd.local)"
    },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) throw new Error(`Fetch returned ${response.status}`);

  const html = await response.text();
  return {
    title: extractTitle(html) ?? source.name,
    content: htmlToText(html),
    provider: "fetch",
    metadata: {
      contentType: response.headers.get("content-type"),
      lastModified: response.headers.get("last-modified"),
      etag: response.headers.get("etag")
    }
  };
}

function buildDocument(
  source: TrustedSource,
  scraped: ScrapedPage,
  content: string,
  crawledAt: string
): TrustedKnowledgeDocument {
  const contentHash = sha256(content);
  return {
    id: `trusted-ev:${source.id}`,
    source: source.id,
    heading: scraped.title ?? source.name,
    content,
    payload: {
      kind: "trusted_ev_knowledge",
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      publisher: source.publisher,
      topic: source.topic,
      language: source.language,
      trustTier: source.trustTier,
      intendedUse: source.intendedUse,
      crawlProvider: scraped.provider,
      crawledAt,
      contentHash,
      extracted: extractSignals(content, source),
      scrapeMetadata: scraped.metadata
    }
  };
}

function toKnowledgeDocumentRow(document: TrustedKnowledgeDocument) {
  return {
    id: document.id,
    source: document.source,
    heading: document.heading,
    content: document.content,
    payload: document.payload
  };
}

async function buildKnowledgeChunks(documents: TrustedKnowledgeDocument[]): Promise<KnowledgeChunkUploadRow[]> {
  const rows: KnowledgeChunkUploadRow[] = [];

  for (const document of documents) {
    const chunks = chunkText(document.content);
    for (const [index, content] of chunks.entries()) {
      const contentHash = sha256(content);
      const embedding = await createDocumentEmbeddingWithRetry(content, document.heading);
      rows.push({
        id: `${document.id}:chunk:${index}`,
        document_id: document.id,
        topic: document.payload.topic,
        source: document.source,
        language: document.payload.language,
        heading: `${document.heading}${chunks.length > 1 ? ` (${index + 1}/${chunks.length})` : ""}`,
        content,
        content_hash: contentHash,
        embedding: embedding ? `[${embedding.join(",")}]` : null,
        metadata: {
          kind: "trusted_ev_knowledge_chunk",
          sourceId: document.payload.sourceId,
          sourceName: document.payload.sourceName,
          sourceUrl: document.payload.sourceUrl,
          publisher: document.payload.publisher,
          topic: document.payload.topic,
          language: document.payload.language,
          trustTier: document.payload.trustTier,
          intendedUse: document.payload.intendedUse,
          contentHash,
          documentContentHash: document.payload.contentHash,
          chunkIndex: index,
          chunkCount: chunks.length,
          crawledAt: document.payload.crawledAt,
          embeddingModel: openAiEmbeddingModel(),
          embeddingDimensions: embeddingDimensions(),
          extracted: extractSignals(content, {
            id: document.payload.sourceId,
            name: document.payload.sourceName,
            publisher: document.payload.publisher,
            url: document.payload.sourceUrl,
            topic: document.payload.topic,
            language: document.payload.language,
            trustTier: document.payload.trustTier,
            intendedUse: document.payload.intendedUse
          })
        }
      });
    }
  }

  return rows;
}

async function upsert(table: string, rows: unknown[]): Promise<UploadResult> {
  const supabase = getSupabaseRestConfig();
  if (!supabase) throw new Error("Supabase config is missing.");

  let inserted = 0;
  for (const rowsChunk of chunk(rows, 80)) {
    const response = await fetch(`${supabase.url}/rest/v1/${table}?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabase.headers,
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

function extractSignals(content: string, source: TrustedSource) {
  const text = normalizeForSearch(content);
  const entities = knownModels
    .filter(([, , pattern]) => pattern.test(content))
    .map(([make, model]) => ({ make, model }));

  return {
    entities,
    metrics: {
      kmMentions: extractNumberMentions(content, /(\d{2,4}(?:[.,]\d+)?)\s*(?:km|kilometer)\b/gi, "km"),
      kwhMentions: extractNumberMentions(content, /(\d{1,3}(?:[.,]\d+)?)\s*kwh\b/gi, "kWh"),
      kwMentions: extractNumberMentions(content, /(\d{1,4}(?:[.,]\d+)?)\s*kw\b/gi, "kW"),
      minuteMentions: extractNumberMentions(content, /(\d{1,3})\s*(?:min|minute|minutes|minuten)\b/gi, "minutes"),
      euroMentions: extractNumberMentions(content, /(?:eur|euro|€)\s*(\d{2,6}(?:[.,]\d+)?)/gi, "EUR")
    },
    flags: {
      incentiveClosed:
        source.topic === "austrian_incentive" &&
        /(abgeschlossen|budget.*ausgesch[oö]pft|registrierungen sind nicht mehr m[oö]glich|keine f[oö]rdermittel)/i.test(content),
      mentionsAwd: /\b(awd|all-wheel|allrad|4x4|quattro|xdrive|htrac)\b/i.test(content),
      mentionsHeatPump: /\b(heat pump|w[aä]rmepumpe)\b/i.test(content),
      mentionsWinter: /\b(winter|k[aä]lte|snow|schnee|ski|alpen)\b/i.test(content),
      mentionsFastCharging: /\b(dc|ccs|combo\s?2|schnelllad|ultra-?fast|800-?volt|350\s*kw)\b/i.test(content),
      mentionsPublicCharging: /\b(public charging|öffentlich|ladestellenverzeichnis|ladepunkt|recharging points?)\b/i.test(content),
      mentionsApartmentCharging: /\b(mehrparteienhaus|apartment|wohnung|right-?to-?plug|weg)\b/i.test(content),
      hasOfficialSource: source.trustTier === "official",
      hasIndependentTestSource: source.trustTier === "independent_test"
    },
    searchTags: [
      source.topic,
      source.trustTier,
      ...source.intendedUse,
      text.includes("winter") ? "winter" : null,
      text.includes("allrad") || text.includes("awd") ? "awd" : null,
      text.includes("wärmepumpe") || text.includes("heat pump") ? "heat_pump" : null,
      text.includes("ccs") ? "ccs" : null,
      text.includes("förder") || text.includes("incentive") ? "incentive" : null
    ].filter((value): value is string => Boolean(value))
  };
}

function extractNumberMentions(content: string, pattern: RegExp, unit: string) {
  const matches: Array<{ value: number; unit: string; context: string }> = [];
  for (const match of content.matchAll(pattern)) {
    const raw = match[1]?.replace(",", ".");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const index = match.index ?? 0;
    matches.push({
      value,
      unit,
      context: compactWhitespace(content.slice(Math.max(0, index - 80), index + 120)).slice(0, 220)
    });
  }
  return dedupeNumberMentions(matches).slice(0, 25);
}

function dedupeNumberMentions(matches: Array<{ value: number; unit: string; context: string }>) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.value}:${match.unit}:${match.context.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chunkText(content: string) {
  const blocks = content
    .split(/\n{2,}/)
    .map((block) => compactWhitespace(block))
    .filter((block) => block.length >= 60);
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks.flatMap(splitLongBlock)) {
    if (!current) {
      current = block;
      continue;
    }

    if (current.length + block.length + 2 > 1400) {
      chunks.push(current);
      current = block;
    } else {
      current = `${current}\n\n${block}`;
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [compactWhitespace(content).slice(0, 1400)];
}

function splitLongBlock(block: string) {
  if (block.length <= 1400) return [block];
  const sentences = block.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 > 1200 && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(h[1-6]|p|li|tr|section|article|div|br)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function normalizeContent(content: string) {
  return content
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => compactWhitespace(line))
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactWhitespace(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    gt: ">",
    lt: "<",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    copy: "(c)"
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    }
    if (normalized.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    }
    return named[normalized] ?? `&${entity};`;
  });
}

function extractTitle(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? compactWhitespace(title) : null;
}

function selectSources(options: IngestOptions) {
  const filtered = options.sourceIds.size
    ? trustedSources.filter((source) => options.sourceIds.has(source.id))
    : trustedSources;
  return options.maxSources ? filtered.slice(0, options.maxSources) : filtered;
}

function parseArgs(args: string[]): IngestOptions {
  const sourceIds = new Set<string>();
  let maxSources: number | null = null;
  let embeddingDelayMs = Number(process.env.FLOWRYD_EMBEDDING_DELAY_MS ?? 400);
  let embeddingRetries = Number(process.env.FLOWRYD_EMBEDDING_RETRIES ?? 3);

  for (const arg of args) {
    if (arg.startsWith("--source=")) {
      for (const sourceId of arg.slice("--source=".length).split(",")) {
        if (sourceId.trim()) sourceIds.add(sourceId.trim());
      }
    }
    if (arg.startsWith("--max-sources=")) {
      const value = Number(arg.slice("--max-sources=".length));
      if (Number.isFinite(value) && value > 0) maxSources = value;
    }
    if (arg.startsWith("--embedding-delay-ms=")) {
      const value = Number(arg.slice("--embedding-delay-ms=".length));
      if (Number.isFinite(value) && value >= 0) embeddingDelayMs = value;
    }
    if (arg.startsWith("--embedding-retries=")) {
      const value = Number(arg.slice("--embedding-retries=".length));
      if (Number.isFinite(value) && value >= 0) embeddingRetries = value;
    }
  }

  return {
    dryRun: args.includes("--dry-run"),
    skipDb: args.includes("--skip-db"),
    noFirecrawl: args.includes("--no-firecrawl"),
    firecrawlOnly: args.includes("--firecrawl-only"),
    listSources: args.includes("--list-sources"),
    sourceIds,
    maxSources,
    embeddingDelayMs,
    embeddingRetries
  };
}

async function createDocumentEmbeddingWithRetry(content: string, heading: string) {
  const attempts = Math.max(1, options.embeddingRetries + 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const embedding = await createDocumentEmbedding(content, heading);
    if (embedding) {
      await sleep(options.embeddingDelayMs);
      return embedding;
    }

    if (attempt < attempts) {
      await sleep(options.embeddingDelayMs * attempt);
    }
  }

  return null;
}

function sleep(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function chunk<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
