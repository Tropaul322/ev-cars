// bmw-boerse.at parser.
//
// bmw-boerse.at runs TYPO3 with the `tx_ems_vehiclesearch` extension. Listings
// are SERVER-RENDERED into body-type category pages under /autotypen/<slug>,
// so a plain browser request (no proxy) returns the cards. Pagination uses
// path segments: /autotypen/<slug>/p/<n> (discovered from the page's
// pagination nav, which we follow until no new BEV cards appear).
//
// There is no fuel filter in the URL, so we fetch every body-type page and
// keep only BMW's battery-electric "i" models (iX / iX1-3 / i3-i7).
import { sha256 } from "../html.ts";
import { cacheFilePath, type InventoryFetcher } from "../fetcher-common.ts";
import type { InventorySourceConfig, RawListing } from "../types.ts";
import { makeRawListing, parseInteger, type ParserContext } from "./common.ts";

const BASE = "https://www.bmw-boerse.at";
const CATEGORIES = [
  "gebrauchte-bmw-suv-sav", // iX, iX1, iX2, iX3
  "limousine", // i4, i5, i7
  "touring-kombi", // i5 Touring
  "coupe", // i4 Gran Coupé
  "cabrio-roadster",
  "van"
];

// BMW battery-electric model names: iX, iX1-3, i3-i7. Requires the "BMW i…"
// prefix so petrol trims like "320i" or "M135i" (which merely END in i) are
// excluded.
const BEV_MODEL_RE = /\bBMW\s+i(x\s?[0-9]?|[3-7])\b/i;

const CARD_SPLIT = /<h3[^>]*class="[^"]*search-item-title[^"]*"/i;
const LINK_RE =
  /<a[^>]*class="[^"]*search-item-link[^"]*"[^>]*href="(https:\/\/www\.bmw-boerse\.at\/suche\/details\/(\d+))"[^>]*>([\s\S]*?)<\/a>/i;
const PRICE_RE = /class="[^"]*\bprice\b[^"]*"[^>]*>\s*<div>\s*€\s*([\d.]+)/i;
const KM_RE = /([\d][\d.]*)\s*km\b/i;
const YEAR_RE = /\b(20[12]\d)\b/;
// Pagination links: <a href="/autotypen/<slug>/p/2" ... class="page-link">
const PAGE_LINK_RE = /href="\/autotypen\/[^"]+\/p\/(\d+)"/g;

// "BMW iX xDrive50" -> { make: "BMW", model: "iX", trim: "xDrive50" }
function splitTitle(title: string) {
  const parts = title.replace(/\s+/g, " ").trim().split(" ");
  return { make: parts[0] || "BMW", model: parts[1] || null, trim: parts.slice(2).join(" ") || null };
}

function cardToRaw(block: string, source: InventorySourceConfig, crawledAt: string): RawListing | null {
  const link = LINK_RE.exec(block);
  if (!link) return null;
  const [, listingUrl, id, rawTitle] = link;
  const title = rawTitle.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!BEV_MODEL_RE.test(title)) return null; // BEV-only

  const price = PRICE_RE.exec(block);
  const km = KM_RE.exec(block);
  const year = YEAR_RE.exec(block);
  const { make, model, trim } = splitTitle(title);
  const text = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500);
  const imageUrl = `${BASE}/api/v2/ems/image/LG/${id}`;

  return makeRawListing(source, crawledAt, {
    listingUrl,
    sourceListingId: id,
    title,
    make,
    model,
    trim,
    condition: "used", // bmw-boerse = Gebrauchtwagenbörse
    priceEUR: price ? parseInteger(price[1]) : null,
    year: year ? parseInteger(year[1]) : null,
    mileageKm: km ? parseInteger(km[1]) : null,
    sellerType: "dealer",
    images: [imageUrl],
    imageDetails: [{ url: imageUrl, source: "bmw_boerse" }],
    text,
    htmlHash: sha256(text || listingUrl)
  });
}

function parseCards(html: string, source: InventorySourceConfig, crawledAt: string) {
  // blocks[0] is the pre-first-card preamble; each subsequent block is one card.
  return html
    .split(CARD_SPLIT)
    .slice(1)
    .map((block) => cardToRaw(block, source, crawledAt))
    .filter((listing): listing is RawListing => listing !== null);
}

function maxPageFromPagination(html: string) {
  let max = 1;
  for (const match of html.matchAll(PAGE_LINK_RE)) {
    max = Math.max(max, parseInt(match[1], 10));
  }
  return max;
}

export async function fetchBmwBoerseListings(
  source: InventorySourceConfig,
  fetcher: InventoryFetcher,
  { maxRows, crawledAt }: ParserContext
) {
  const listings: RawListing[] = [];
  const seen = new Set<string>();

  for (const slug of CATEGORIES) {
    if (listings.length >= maxRows) break;

    let maxPage = 1;
    for (let page = 1; page <= maxPage && listings.length < maxRows; page++) {
      const url = page === 1 ? `${BASE}/autotypen/${slug}` : `${BASE}/autotypen/${slug}/p/${page}`;
      const cacheFile = cacheFilePath(`${source.id}.${slug}.page${page}.html`);
      console.log(`  category ${slug} page ${page}: ${url}`);

      let html: string;
      try {
        // Server-rendered — a direct browser request returns the cards (no proxy).
        html = await fetcher.fetchDirect(url, { cacheFile, politeDelayMs: 400 });
      } catch (error) {
        console.warn(`  bmw-boerse ${slug} page ${page} failed: ${error instanceof Error ? error.message : error}`);
        break;
      }

      maxPage = Math.max(maxPage, maxPageFromPagination(html));

      let added = 0;
      for (const listing of parseCards(html, source, crawledAt)) {
        const key = listing.listingUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        listings.push(listing);
        added += 1;
        if (listings.length >= maxRows) break;
      }
      console.log(`  category ${slug} page ${page}: ${added} BEV cards (total ${listings.length}/${maxRows}, pages=${maxPage})`);
    }
  }

  return listings.slice(0, maxRows);
}
