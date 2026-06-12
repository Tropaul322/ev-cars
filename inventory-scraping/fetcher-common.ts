// Shared fetcher contract for inventory parsers. Both ScrapingBee and
// Crawl4AI implementations cache payloads under cache/raw_html/ so --offline
// re-parses the same files regardless of which engine fetched them.
import fs from "node:fs";
import path from "node:path";

export const rawHtmlCacheDir =
  process.env.FLOWRYD_SCRAPE_CACHE_DIR ??
  path.join(process.cwd(), "inventory-scraping", "cache", "raw_html");

export function safeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function cacheFilePath(name: string) {
  return path.join(rawHtmlCacheDir, safeFilename(name));
}

export type FetcherKind = "scrapingbee" | "crawl4ai";

export type FetchMethod = "direct" | "api" | "html" | "stealth";

export type FetchRecord = {
  fetcher: FetcherKind;
  method: FetchMethod;
  url: string;
  cacheFile: string | null;
  byteLength: number;
  fromCache: boolean;
  fetchedAt: string;
};

const fetchLog: FetchRecord[] = [];

export function logFetch(record: FetchRecord) {
  fetchLog.push(record);
}

export function drainFetchLog() {
  return fetchLog.splice(0, fetchLog.length);
}

export type CacheOptions = { cacheFile?: string | null };

export type InventoryFetcher = {
  readonly offline: boolean;
  fetchApi(url: string, options?: CacheOptions): Promise<string>;
  fetchDirect(
    url: string,
    options?: CacheOptions & { politeDelayMs?: number }
  ): Promise<string>;
  fetchStealth(
    url: string,
    options?: CacheOptions & { waitMs?: number }
  ): Promise<string>;
  fetchHtml(url: string, options?: CacheOptions & { waitFor?: string | null }): Promise<string>;
};

export function readCachedPayload(cacheFile: string | null | undefined, kind: string, fromCache = true) {
  if (cacheFile && fs.existsSync(cacheFile)) {
    const text = fs.readFileSync(cacheFile, "utf8");
    console.log(
      fromCache
        ? `  loaded cached ${kind} (${text.length} bytes): ${path.basename(cacheFile)}`
        : `  read ${kind} (${text.length} bytes): ${path.basename(cacheFile)}`
    );
    return text;
  }
  throw new Error(`offline: no cached ${kind}${cacheFile ? ` (${cacheFile})` : ""}`);
}

export function writeCachedPayload(cacheFile: string | null | undefined, text: string) {
  if (cacheFile) fs.writeFileSync(cacheFile, text, "utf8");
}

export function ensureCacheDir(offline: boolean) {
  if (!offline) fs.mkdirSync(rawHtmlCacheDir, { recursive: true });
}
