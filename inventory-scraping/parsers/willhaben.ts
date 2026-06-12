// willhaben.at parser.
//
// willhaben is a Next.js app and ships its search results as JSON in the page
// (<script id="__NEXT_DATA__">) at:
//   props.pageProps.searchResult.advertSummaryList.advertSummary[]
// Each advert carries an `attributes.attribute[]` list ({name, values}).
//
// willhaben is protected by DataDome, so a plain fetch returns 403; only a
// full JS render through stealth residential proxies gets through. Deep
// A single search is capped at ~20 pages, so we split into price bands and
// paginate each until no new adverts appear. BEV filter: ENGINE/FUEL=100004.
//
// robots.txt forbids spiders; this source is gated behind permissionConfirmed.
import { sha256 } from "../html.ts";
import { cacheFilePath, type InventoryFetcher } from "../fetcher-common.ts";
import type { InventorySourceConfig, RawListing } from "../types.ts";
import {
  detectFeatures,
  listingKey,
  makeRawListing,
  mapBodyType,
  mapCondition,
  parseInteger,
  setPageParam,
  type ParserContext
} from "./common.ts";

const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const IMG_CDN = "https://cache.willhaben.at/mmo/";
// Bands that split the BEV inventory into separately paginated searches.
const PRICE_BANDS: Array<[from: number, to: number]> = [
  [0, 15_000],
  [15_000, 25_000],
  [25_000, 35_000],
  [35_000, 50_000],
  [50_000, 80_000],
  [80_000, 999_999]
];

type WillhabenAdvert = {
  description?: string;
  attributes?: { attribute?: Array<{ name?: string; values?: string[] | string }> };
  advertImageList?: { advertImage?: Array<{ mainImageUrl?: string }> };
};

type WillhabenPageProps = {
  searchResult?: {
    rowsFound?: number;
    rowsReturned?: number;
    advertSummaryList?: { advertSummary?: WillhabenAdvert[] };
  };
};

function extractPageProps(html: string): WillhabenPageProps | null {
  const match = NEXT_DATA_RE.exec(html);
  if (!match) return null;
  try {
    return (JSON.parse(match[1]) as { props?: { pageProps?: WillhabenPageProps } }).props?.pageProps ?? null;
  } catch {
    return null;
  }
}

// advert.attributes.attribute[] -> { NAME: firstValue }
function attrMap(advert: WillhabenAdvert) {
  const out: Record<string, string> = {};
  for (const attribute of advert.attributes?.attribute ?? []) {
    if (!attribute?.name) continue;
    const value = Array.isArray(attribute.values) ? attribute.values[0] : attribute.values;
    if (value !== undefined) out[attribute.name] = value;
  }
  return out;
}

function advertToRaw(advert: WillhabenAdvert, source: InventorySourceConfig, crawledAt: string): RawListing | null {
  const attrs = attrMap(advert);
  const make = attrs["CAR_MODEL/MAKE"] ?? null;
  const model = attrs["CAR_MODEL/MODEL"] ?? null;

  const seo = attrs["SEO_URL"];
  if (!seo) return null;
  const listingUrl = `https://www.willhaben.at/iad/${seo.replace(/^\//, "")}`;
  const image = advert.advertImageList?.advertImage?.[0]?.mainImageUrl ?? (attrs["MMO"] ? IMG_CDN + attrs["MMO"] : null);
  const text = (advert.description ?? "").slice(0, 1500);

  return makeRawListing(source, crawledAt, {
    listingUrl,
    title: attrs["HEADING"] || advert.description || [make, model].filter(Boolean).join(" ") || "EV listing",
    make,
    model,
    trim: attrs["CAR_MODEL/MODEL_SPECIFICATION"] ?? null,
    condition: mapCondition(attrs["CONDITION_RESOLVED"]),
    priceEUR: parseInteger(attrs["PRICE"]),
    priceLabel: attrs["PRICE_FOR_DISPLAY"] ?? null,
    year: parseInteger(attrs["YEAR_MODEL"]),
    mileageKm: parseInteger(attrs["MILEAGE"]),
    bodyType: mapBodyType(attrs["CAR_TYPE"]),
    location: [attrs["POSTCODE"], attrs["STATE"] ?? attrs["LOCATION"]].filter(Boolean).join(" ") || null,
    sellerType: attrs["ISPRIVATE"] === "1" ? "private" : "dealer",
    images: image ? [image] : [],
    imageDetails: image ? [{ url: image, source: "willhaben" }] : [],
    features: detectFeatures(text),
    text,
    htmlHash: sha256(text || listingUrl)
  });
}

function searchVariants(sourceUrl: string) {
  // Base search plus price bands — each band is paginated separately because
  // willhaben caps how many pages a single query returns.
  const variants = [sourceUrl];
  for (const [from, to] of PRICE_BANDS) {
    const url = new URL(sourceUrl);
    url.searchParams.set("PRICE_FROM", String(from));
    url.searchParams.set("PRICE_TO", String(to));
    variants.push(url.toString());
  }
  return [...new Set(variants)];
}

// Safety cap per price-band search — well above willhaben's ~20-page limit.
const MAX_PAGES_PER_VARIANT = 500;

export async function fetchWillhabenListings(
  source: InventorySourceConfig,
  fetcher: InventoryFetcher,
  { maxRows, crawledAt }: ParserContext
) {
  const unlimited = maxRows >= Number.MAX_SAFE_INTEGER / 2;
  const listings: RawListing[] = [];
  const seen = new Set<string>();
  const variants = searchVariants(source.url);

  for (const [variantIndex, variantUrl] of variants.entries()) {
    if (!unlimited && listings.length >= maxRows) break;
    for (let page = 1; page <= MAX_PAGES_PER_VARIANT; page++) {
      if (!unlimited && listings.length >= maxRows) break;
      const pageUrl = setPageParam(variantUrl, "page", page);
      const cacheFile = cacheFilePath(`${source.id}.v${variantIndex}.page${page}.html`);
      console.log(`  variant ${variantIndex + 1}/${variants.length} page ${page}: ${pageUrl}`);

      let html: string;
      try {
        html = await fetcher.fetchStealth(pageUrl, { cacheFile });
      } catch (error) {
        console.warn(`  willhaben page ${page} failed: ${error instanceof Error ? error.message : error}`);
        break;
      }

      const pageProps = extractPageProps(html);
      const adverts = pageProps?.searchResult?.advertSummaryList?.advertSummary;
      if (!Array.isArray(adverts) || !adverts.length) {
        console.log(`  page ${page}: no adverts — end of this search variant`);
        break;
      }
      if (page === 1) {
        const total = pageProps?.searchResult?.rowsFound ?? pageProps?.searchResult?.rowsReturned;
        console.log(`  willhaben reports ~${total ?? "?"} EV results for this search`);
      }

      let added = 0;
      for (const advert of adverts) {
        if (!advert || typeof advert !== "object") continue;
        const listing = advertToRaw(advert, source, crawledAt);
        if (!listing) continue;
        const key = listingKey(listing);
        if (seen.has(key)) continue;
        seen.add(key);
        listings.push(listing);
        added += 1;
        if (!unlimited && listings.length >= maxRows) break;
      }
      console.log(`  page ${page} added ${added} new rows (total ${listings.length}${unlimited ? "" : `/${maxRows}`})`);
      if (added === 0) break;
    }
  }

  return unlimited ? listings : listings.slice(0, maxRows);
}
