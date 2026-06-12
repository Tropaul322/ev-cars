// Tesla inventory parser.
//
// Tesla does not put inventory in the page HTML — the page is a JS app that
// calls a public JSON endpoint (/inventory/api/v4/inventory-results). This
// parser hits that endpoint directly and pages through it via offset until
// the reported total is exhausted or maxRows is reached.
//
// The endpoint sits behind Akamai bot protection and is frequently blocked;
// the fetcher escalates standard -> premium -> stealth proxies. When even the
// first request is blocked the source yields zero rows (no substitution).
import { sha256 } from "../html.ts";
import { cacheFilePath, type InventoryFetcher } from "../fetcher-common.ts";
import type { InventorySourceConfig, RawListing } from "../types.ts";
import { makeRawListing, type ParserContext } from "./common.ts";

const API_BASE = "https://www.tesla.com/inventory/api/v4/inventory-results";
const MODEL_NAMES: Record<string, string> = { m3: "Model 3", my: "Model Y", ms: "Model S", mx: "Model X" };
const PAGE_COUNT = 50;

type TeslaResult = {
  Model?: string;
  TrimName?: string;
  OptionCodeData?: unknown;
  Year?: number | string;
  InventoryPrice?: number;
  TotalPrice?: number;
  Price?: number;
  PurchasePrice?: number;
  Odometer?: number | string;
  VIN?: string;
  City?: string;
  StateProvince?: string;
  CountryCode?: string;
  PAINT?: string[];
};

type TeslaResponse = {
  results?: TeslaResult[] | { approved?: TeslaResult[] };
  total_matches_found?: string | number;
  total_match_count?: string | number;
};

function buildUrl(model: string, condition: string, offset: number) {
  const query = {
    query: {
      model,
      condition,
      options: {},
      arrangeby: "Price",
      order: "asc",
      market: "AT",
      language: "de",
      super_region: "europe",
      lng: "",
      lat: "",
      zip: "",
      range: 0
    },
    offset,
    count: PAGE_COUNT,
    outsideOffset: 0,
    outsideSearch: false
  };
  return `${API_BASE}?query=${encodeURIComponent(JSON.stringify(query))}`;
}

// Tesla returns odometer as a string like "2 Km" (or sometimes a number).
function odometerKm(value: TeslaResult["Odometer"]) {
  if (typeof value === "number") return Math.trunc(value);
  if (typeof value === "string") {
    const digits = value.match(/[\d.,]+/)?.[0].replace(/[.,]/g, "");
    if (digits && /^\d+$/.test(digits)) return parseInt(digits, 10);
  }
  return null;
}

function resultToRaw(
  result: TeslaResult,
  condition: "new" | "used",
  source: InventorySourceConfig,
  crawledAt: string
): RawListing {
  const modelCode = (result.Model ?? "").toLowerCase();
  const modelName = MODEL_NAMES[modelCode] ?? result.TrimName ?? modelCode;
  const vin = result.VIN ?? null;
  const listingUrl = vin ? `https://www.tesla.com/de_AT/${modelCode}/order/${vin}` : source.url;
  // InventoryPrice/TotalPrice are the gross EUR list price; PurchasePrice is
  // the net (ex-VAT) figure, so prefer the gross fields.
  const price = result.InventoryPrice ?? result.TotalPrice ?? result.Price ?? result.PurchasePrice ?? null;
  const text = JSON.stringify(result).toLowerCase().slice(0, 1500);

  let year: number | null = null;
  if (typeof result.Year === "number") year = Math.trunc(result.Year);
  else if (typeof result.Year === "string" && /^\d+$/.test(result.Year)) year = parseInt(result.Year, 10);

  const features = ["adaptive_cruise_control"]; // standard Autopilot
  if (text.includes("heated") || text.includes("sitzheizung")) features.push("heated_seats");
  if (text.includes("premium") && text.includes("audio")) features.push("premium_audio");

  return makeRawListing(source, crawledAt, {
    listingUrl,
    sourceListingId: vin,
    title: `${result.Year ?? ""} Tesla ${modelName}`.trim(),
    make: "Tesla",
    model: modelName,
    trim: typeof result.TrimName === "string" ? result.TrimName : null,
    condition,
    priceEUR: typeof price === "number" ? price : null,
    year,
    mileageKm: odometerKm(result.Odometer),
    location: [result.City, result.StateProvince, result.CountryCode].filter(Boolean).join(", ") || null,
    sellerType: "oem",
    sellerName: "Tesla",
    vin,
    features,
    text,
    htmlHash: sha256(text || listingUrl)
  });
}

export async function fetchTeslaListings(
  source: InventorySourceConfig,
  fetcher: InventoryFetcher,
  { maxRows, crawledAt }: ParserContext
) {
  const models = source.teslaModels ?? ["m3", "my"];
  const conditions = source.teslaConditions ?? ["new", "used"];

  const listings: RawListing[] = [];
  const seen = new Set<string>();
  let firstRequest = true;

  for (const model of models) {
    for (const condition of conditions) {
      let offset = 0;
      while (listings.length < maxRows) {
        const url = buildUrl(model, condition, offset);
        const cacheFile = cacheFilePath(`${source.id}.api.${model}.${condition}.${offset}.json`);

        const wasFirst = firstRequest;
        firstRequest = false;
        let data: TeslaResponse;
        try {
          data = JSON.parse(await fetcher.fetchApi(url, { cacheFile })) as TeslaResponse;
        } catch (error) {
          console.warn(
            `  tesla API page failed (${model}/${condition} offset=${offset}): ${error instanceof Error ? error.message : error}`
          );
          // If the very first request is blocked, the whole API is unreachable
          // (Akamai bot-gate) — don't hammer the other model/condition combos.
          if (wasFirst && listings.length === 0) {
            console.warn("  tesla API unreachable (bot-blocked); skipping remaining Tesla queries");
            return listings;
          }
          break;
        }

        let results = data.results ?? [];
        if (!Array.isArray(results)) results = results.approved ?? [];
        if (!results.length) break;

        const total = data.total_matches_found ?? data.total_match_count;
        console.log(`  tesla ${model}/${condition} offset=${offset} -> ${results.length} results (total=${total ?? "?"})`);

        for (const result of results) {
          const listing = resultToRaw(result, condition, source, crawledAt);
          const key = listing.vin ?? listing.listingUrl;
          if (seen.has(key)) continue;
          seen.add(key);
          listings.push(listing);
          if (listings.length >= maxRows) break;
        }

        offset += PAGE_COUNT;
        if (total && offset >= parseInt(String(total), 10)) break;
      }
    }
  }

  return listings.slice(0, maxRows);
}
