// Generic vehicle-card parser for OEM/brand pages without structured data
// (e.g. the VW Austria EV-leasing page). Tries a series of card-ish selectors,
// keeps elements whose text shows a currency amount, and extracts
// price/mileage/year/title heuristically. Paginates via a `page` query param
// when the source keeps yielding new rows.
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { sha256 } from "../html.ts";
import { cacheFilePath, type InventoryFetcher } from "../fetcher-common.ts";
import type { InventorySourceConfig, RawListing } from "../types.ts";
import { detectFeatures, listingKey, makeRawListing, setPageParam, type ParserContext } from "./common.ts";

// Matches a currency amount in either order: "€ 42.990" or "42.990 €".
const PRICE_PRESENT_RE = /(?:€|EUR)\s?[\d.,]+|[\d.,]+\s?(?:€|EUR)/i;
// Non-consuming passes so "Model 3 € 42.990" yields "42.990", not "3".
const PRICE_AFTER_RE = /(?:€|EUR)\s?([\d.,]+)/gi;
const PRICE_BEFORE_RE = /([\d.,]+)\s?(?:€|EUR)/gi;
const KM_RE = /([\d.,]+)\s?km/i;
const YEAR_RE = /\b(20[0-3][0-9]|19[8-9][0-9])\b/;

const KNOWN_EV_MAKES = [
  "Tesla", "BMW", "Volkswagen", "VW", "Audi", "Mercedes", "BYD", "MG",
  "NIO", "XPeng", "Polestar", "Kia", "Hyundai", "Renault", "Peugeot",
  "Citroën", "Opel", "Fiat", "Volvo", "Smart", "Škoda", "Skoda", "Cupra"
];

function toNumber(raw: string) {
  // European format: "." = thousands, "," = decimal -> normalize to a float.
  const normalized = raw.replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".");
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = parseFloat(match[0]);
  return Number.isNaN(value) ? null : value;
}

// Scan every currency match and return the most plausible gross price:
// ignore values below 100 (stray digits like the "3" in "Model 3") and prefer
// the largest candidate.
export function parsePrice(text: string) {
  const candidates: number[] = [];
  for (const re of [PRICE_AFTER_RE, PRICE_BEFORE_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      const value = toNumber(match[1]);
      if (value !== null && value >= 100) candidates.push(value);
    }
  }
  return candidates.length ? Math.max(...candidates) : null;
}

function parseMileage(text: string) {
  const match = KM_RE.exec(text);
  if (!match) return null;
  const value = parseInt(match[1].replace(/[.,]/g, ""), 10);
  return Number.isNaN(value) ? null : value;
}

function detectMake(text: string) {
  const lower = text.toLowerCase();
  return KNOWN_EV_MAKES.find((make) => lower.includes(make.toLowerCase())) ?? null;
}

// Document-order text extraction that inserts a space between nodes, so
// "<span>Model 3</span><span>€ 42.990</span>" -> "Model 3 € 42.990".
function extractText($: cheerio.CheerioAPI, node: AnyNode): string {
  const parts: string[] = [];
  $(node)
    .contents()
    .each((_, child) => {
      if (child.type === "text") {
        const text = (child.data ?? "").trim();
        if (text) parts.push(text);
      } else if (child.type === "tag") {
        const text = extractText($, child);
        if (text) parts.push(text);
      }
    });
  return parts.join(" ");
}

function absoluteUrl(base: string, href: string | undefined) {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function buildListing(
  $: cheerio.CheerioAPI,
  card: AnyNode,
  source: InventorySourceConfig,
  pageUrl: string,
  crawledAt: string
): RawListing {
  const text = extractText($, card).replace(/\s+/g, " ").trim();

  const listingUrl = absoluteUrl(pageUrl, $(card).find("a[href]").first().attr("href")) ?? pageUrl;
  const imageUrl = absoluteUrl(pageUrl, $(card).find("img").first().attr("src"));

  let title: string | null = null;
  for (const selector of ["h1", "h2", "h3", "h4"]) {
    const el = $(card).find(selector).first();
    if (el.length) {
      title = extractText($, el[0]).replace(/\s+/g, " ").trim();
      break;
    }
  }
  if (!title) title = text ? text.slice(0, 120) : null;

  const year = YEAR_RE.exec(text);
  const price = parsePrice(text);

  return makeRawListing(source, crawledAt, {
    listingUrl,
    title,
    make: detectMake(text),
    priceEUR: price ? Math.round(price) : null,
    mileageKm: parseMileage(text),
    year: year ? parseInt(year[1], 10) : null,
    images: imageUrl ? [imageUrl] : [],
    imageDetails: imageUrl ? [{ url: imageUrl, source: "generic_card" }] : [],
    features: detectFeatures(text),
    text: text.slice(0, 1500),
    htmlHash: sha256(text || listingUrl)
  });
}

export function parseGenericVehiclePage(
  html: string,
  source: InventorySourceConfig,
  pageUrl: string,
  crawledAt: string,
  maxRows: number
) {
  const $ = cheerio.load(html);

  const candidateSelectors = [
    "[data-testid*='card']",
    "[class*='card']",
    "[class*='vehicle']",
    "[class*='listing']",
    "article",
    "li"
  ];

  let cards: AnyNode[] = [];
  let chosenSelector: string | null = null;
  for (const selector of candidateSelectors) {
    // Fast pre-filter: only keep elements whose text shows a currency amount.
    const useful = $(selector)
      .toArray()
      .filter((card) => PRICE_PRESENT_RE.test($(card).text() ?? ""));
    if (useful.length) {
      cards = useful;
      chosenSelector = selector;
      break;
    }
  }
  console.log(`    matched ${cards.length} card(s) with a price via selector "${chosenSelector ?? "(none)"}"`);

  const listings: RawListing[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const listing = buildListing($, card, source, pageUrl, crawledAt);
    const key = listingKey(listing);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    listings.push(listing);
    if (listings.length >= maxRows) break;
  }
  return listings;
}

export async function fetchGenericVehicleListings(
  source: InventorySourceConfig,
  fetcher: InventoryFetcher,
  { maxRows, crawledAt }: ParserContext
) {
  const listings: RawListing[] = [];
  const seen = new Set<string>();
  // Try `page` pagination only while pages keep yielding new rows; most OEM
  // offer pages are a single page and stop after page 1.
  const maxPages = fetcher.offline ? 1 : Math.max(1, Math.ceil(maxRows / 10));

  for (let page = 1; page <= maxPages && listings.length < maxRows; page++) {
    const pageUrl = page === 1 ? source.url : setPageParam(source.url, "page", page);
    const cacheFile = cacheFilePath(`${source.id}.page${page}.html`);
    console.log(`  page ${page}: ${pageUrl}`);

    let html: string;
    try {
      html = await fetcher.fetchHtml(pageUrl, { cacheFile, waitFor: source.waitFor ?? null });
    } catch (error) {
      console.warn(`  generic page ${page} failed: ${error instanceof Error ? error.message : error}`);
      break;
    }

    let added = 0;
    for (const listing of parseGenericVehiclePage(html, source, pageUrl, crawledAt, maxRows)) {
      const key = listingKey(listing);
      if (seen.has(key)) continue;
      seen.add(key);
      listings.push(listing);
      added += 1;
      if (listings.length >= maxRows) break;
    }
    console.log(`  page ${page} added ${added} new rows (total ${listings.length}/${maxRows})`);
    if (added === 0) break;
  }

  return listings.slice(0, maxRows);
}
