import type { BodyType, InventorySource, VehicleCondition, VehicleImage, VehicleSellerType } from "../lib/types.ts";

export type InventorySourceKind = "inventory" | "context";

// Structured per-source parsers (ported from the PoC). Sources without a
// parser go through the generic Firecrawl discovery pipeline instead.
export type StructuredParser =
  | "autoscout24"
  | "willhaben"
  | "tesla_api"
  | "bmw_boerse"
  | "generic_vehicle"
  | "rag_page";

export type InventorySourceConfig = {
  id: string;
  name: string;
  source: InventorySource;
  kind: InventorySourceKind;
  url: string;
  market: "AT" | "SK" | "CZ" | "EU";
  parser?: StructuredParser;
  // Marketplace ToS gate (willhaben/AutoScout24/gebrauchtwagen): these sources
  // are hard-blocked unless the operator explicitly confirms permission.
  permissionConfirmed?: boolean;
  waitFor?: string;
  teslaModels?: string[];
  teslaConditions?: VehicleCondition[];
  conditionHint?: VehicleCondition;
  sellerTypeHint?: VehicleSellerType;
  maxListingPages?: number;
  listingUrlPatterns?: RegExp[];
  includeUrlPatterns?: RegExp[];
  notes: string;
};

export type RawListing = {
  sourceId: string;
  source: InventorySource;
  sourceName: string;
  sourceUrl: string;
  listingUrl: string;
  canonicalUrl: string | null;
  sourceListingId: string | null;
  crawledAt: string;
  fetchedAt: string;
  title: string | null;
  priceEUR: number | null;
  priceLabel: string | null;
  condition: VehicleCondition | null;
  mileageKm: number | null;
  year: number | null;
  firstRegistration: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  rangeKm: number | null;
  batteryKwh: number | null;
  efficiencyKwhPer100Km: number | null;
  bodyType: BodyType | null;
  location: string | null;
  sellerName: string | null;
  sellerType: VehicleSellerType;
  exteriorColor: string | null;
  doors: number | null;
  transmission: string | null;
  powerKw: number | null;
  warranty: string | null;
  features: string[];
  images: string[];
  imageDetails: VehicleImage[];
  text: string;
  htmlHash: string;
  vin?: string | null;
};

// Heading/text record extracted from a context (RAG) page.
export type RagRecord = {
  source: string;
  sourceUrl: string;
  heading: string | null;
  text: string;
};

export type ContextPage = {
  sourceId: string;
  name: string;
  url: string;
  kind: "context";
  market: InventorySourceConfig["market"];
  crawledAt: string;
  title: string | null;
  content: string;
  htmlHash: string;
  notes: string;
};

export type CrawlOptions = {
  dryRun: boolean;
  skipDb: boolean;
  offline: boolean;
  fetcher: "scrapingbee" | "crawl4ai";
  explicitMaxListings: boolean;
  listSources: boolean;
  sourceIds: Set<string>;
  maxListingsPerSource: number;
  maxPagesPerSource: number;
  requestDelayMs: number;
  skipEmbeddings: boolean;
};

export type CrawlSummary = {
  crawledAt: string;
  inventorySourcesAttempted: number;
  contextSourcesAttempted: number;
  rawListingsFound: number;
  vehiclesNormalized: number;
  duplicateListingsSkipped: number;
  contextPagesScraped: number;
  failures: Array<{ sourceId: string; url: string; error: string }>;
};
