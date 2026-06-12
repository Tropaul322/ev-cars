// AutoScout24 (and its operated sibling gebrauchtwagen.at) parser.
//
// AutoScout24's search pages are a Next.js app that ships the full result set
// as JSON in a <script id="__NEXT_DATA__"> tag — no DOM-card scraping needed.
// We parse that JSON (pageProps.listings) and paginate via the `page` query
// param. A single search is capped by the site (~20 pages), so when the target
// row count exceeds one search's reach we re-run the search split into price
// bands, which together cover the inventory.
//
// NOTE: gated behind permissionConfirmed in the source config because
// AutoScout24's terms restrict automated querying.
import type { VehicleCondition } from "../../lib/types.ts";
import { sha256 } from "../html.ts";
import { cacheFilePath, type InventoryFetcher } from "../fetcher-common.ts";
import type { InventorySourceConfig, RawListing } from "../types.ts";
import {
  detectFeatures,
  listingKey,
  makeRawListing,
  mapBodyType,
  parseBatteryKwh,
  parseEfficiency,
  parseEuro,
  parseInteger,
  parseRangeKm,
  setPageParam,
  yearFromText,
  type ParserContext
} from "./common.ts";

const NEXT_DATA_RE = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;
const PAGE_SIZE = 20; // AutoScout24 serves 20 listings per results page

const OFFER_TYPE: Record<string, VehicleCondition> = { N: "new", U: "used", J: "used", D: "used", O: "used", S: "used" };

// Price bands used to split a search once a single query's page cap is hit.
const PRICE_BANDS: Array<[from: number, to: number]> = [
  [0, 15_000],
  [15_000, 25_000],
  [25_000, 35_000],
  [35_000, 50_000],
  [50_000, 80_000],
  [80_000, 999_999]
];

type AutoscoutListing = {
  url?: string;
  images?: string[];
  wltpValues?: unknown[];
  price?: { priceFormatted?: string; isVatLabelLegallyRequired?: boolean };
  vehicle?: {
    make?: string;
    model?: string;
    modelVersionInput?: string;
    variant?: string;
    subtitle?: string;
    offerType?: string;
    mileageInKm?: string | number;
    articleType?: string;
  };
  vehicleDetails?: Array<{ iconName?: string; data?: string }>;
  location?: { zip?: string; city?: string; countryCode?: string };
  seller?: { companyName?: string; type?: string };
};

type AutoscoutPageProps = {
  listings?: AutoscoutListing[];
  numberOfResults?: number;
  numberOfPages?: number;
};

function extractPageProps(html: string): AutoscoutPageProps | null {
  const match = NEXT_DATA_RE.exec(html);
  if (!match) return null;
  try {
    return (JSON.parse(match[1]) as { props?: { pageProps?: AutoscoutPageProps } }).props?.pageProps ?? null;
  } catch {
    return null;
  }
}

function detailByIcon(details: AutoscoutListing["vehicleDetails"], iconName: string) {
  return details?.find((detail) => detail?.iconName === iconName)?.data ?? null;
}

function listingToRaw(
  listing: AutoscoutListing,
  source: InventorySourceConfig,
  baseUrl: string,
  crawledAt: string
): RawListing {
  const vehicle = listing.vehicle ?? {};
  const details = listing.vehicleDetails ?? [];
  const location = listing.location ?? {};

  const make = vehicle.make ?? null;
  const model = vehicle.model ?? null;
  const trim = vehicle.modelVersionInput ?? vehicle.variant ?? null;
  const featureText = [vehicle.modelVersionInput, vehicle.variant, vehicle.subtitle, vehicle.model]
    .filter(Boolean)
    .join(" ");

  // New cars report a placeholder like "- (Erstzulassung)"; keep only real dates.
  const firstRegRaw = detailByIcon(details, "calendar");
  const firstRegistration = firstRegRaw && /\d{4}/.test(firstRegRaw) ? firstRegRaw : null;
  const listingUrl = listing.url ? new URL(listing.url, baseUrl).href : source.url;
  const images = Array.isArray(listing.images) ? listing.images.filter((url) => typeof url === "string") : [];
  const wltp = Array.isArray(listing.wltpValues) ? listing.wltpValues.map(String) : [];
  const text = [vehicle.make, vehicle.model, vehicle.modelVersionInput, vehicle.subtitle, ...wltp]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1500);

  return makeRawListing(source, crawledAt, {
    listingUrl,
    title: [make, model, vehicle.variant].filter(Boolean).join(" ") || trim || "EV listing",
    make,
    model,
    trim,
    condition: (vehicle.offerType ? OFFER_TYPE[vehicle.offerType] : null) ?? source.conditionHint ?? null,
    priceEUR: parseEuro(listing.price?.priceFormatted),
    priceLabel: listing.price?.priceFormatted ?? null,
    year: yearFromText(firstRegistration),
    firstRegistration,
    mileageKm: parseInteger(vehicle.mileageInKm ?? detailByIcon(details, "mileage_odometer")),
    rangeKm: parseRangeKm(detailByIcon(details, "distance")),
    batteryKwh: parseBatteryKwh(featureText),
    efficiencyKwhPer100Km: parseEfficiency(wltp.find((value) => /kwh\/100/i.test(value))),
    bodyType: mapBodyType(vehicle.articleType),
    location: [location.zip, location.city].filter(Boolean).join(" ") || location.countryCode || null,
    sellerName: listing.seller?.companyName ?? null,
    sellerType: listing.seller?.type?.toLowerCase() === "private" ? "private" : source.sellerTypeHint ?? "dealer",
    images,
    imageDetails: images.map((url) => ({ url, source: "autoscout24" })),
    features: detectFeatures(featureText),
    text,
    htmlHash: sha256(text || listingUrl)
  });
}

function searchVariants(sourceUrl: string, maxRows: number) {
  // One search reaches ~PAGE_SIZE * 20 rows; only split into price bands when
  // the target exceeds that.
  if (maxRows <= PAGE_SIZE * 20) return [sourceUrl];
  const variants: string[] = [];
  for (const [from, to] of PRICE_BANDS) {
    const url = new URL(sourceUrl);
    url.searchParams.set("pricefrom", String(from));
    url.searchParams.set("priceto", String(to));
    variants.push(url.toString());
  }
  return variants;
}

export async function fetchAutoscout24Listings(
  source: InventorySourceConfig,
  fetcher: InventoryFetcher,
  { maxRows, crawledAt }: ParserContext
) {
  const baseUrl = new URL(source.url).origin;
  const listings: RawListing[] = [];
  const seen = new Set<string>();
  const variants = searchVariants(source.url, maxRows);

  for (const [variantIndex, variantUrl] of variants.entries()) {
    if (listings.length >= maxRows) break;

    let numberOfPages: number | null = null;
    const maxPages = fetcher.offline ? 50 : Math.ceil(maxRows / PAGE_SIZE) + 1;

    for (let page = 1; page <= maxPages && listings.length < maxRows; page++) {
      const pageUrl = setPageParam(setPageParam(variantUrl, "size", PAGE_SIZE), "page", page);
      const cacheFile = cacheFilePath(`${source.id}.v${variantIndex}.page${page}.html`);
      console.log(`  variant ${variantIndex + 1}/${variants.length} page ${page}: ${pageUrl}`);

      let html: string;
      try {
        html = await fetcher.fetchDirect(pageUrl, { cacheFile, politeDelayMs: page > 1 ? 900 : 0 });
      } catch (error) {
        console.warn(`  autoscout24 page ${page} failed: ${error instanceof Error ? error.message : error}`);
        break;
      }

      const pageProps = extractPageProps(html);
      if (!pageProps || !Array.isArray(pageProps.listings)) {
        console.warn(`  page ${page}: no listings JSON found (anti-bot challenge or layout change?)`);
        break;
      }

      if (numberOfPages === null) {
        numberOfPages = pageProps.numberOfPages ?? null;
        console.log(`  source reports ${pageProps.numberOfResults ?? "?"} results across ${numberOfPages ?? "?"} pages`);
      }

      let added = 0;
      for (const raw of pageProps.listings) {
        // Skip null/placeholder slots (ads/teasers).
        if (!raw || typeof raw !== "object") continue;
        const listing = listingToRaw(raw, source, baseUrl, crawledAt);
        const key = listingKey(listing);
        if (seen.has(key)) continue;
        seen.add(key);
        listings.push(listing);
        added += 1;
        if (listings.length >= maxRows) break;
      }
      console.log(`  page ${page} added ${added} new rows (total ${listings.length}/${maxRows})`);

      if (added === 0) break;
      if (numberOfPages && page >= numberOfPages) break;
    }
  }

  return listings.slice(0, maxRows);
}
