// Crawl4AI fetcher — Python subprocess wrapper around inventory-scraping/crawl4ai/fetch_page.py.
//
// Mirrors ScrapingBeeFetcher method names so parsers stay unchanged:
//   fetchDirect  -> httpx in Python (SSR pages)
//   fetchApi     -> httpx in Python (JSON APIs)
//   fetchHtml    -> Crawl4AI headless browser
//   fetchStealth -> Crawl4AI with longer post-load delay (willhaben)
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  ensureCacheDir,
  logFetch,
  readCachedPayload,
  writeCachedPayload,
  type CacheOptions,
  type FetchMethod,
  type InventoryFetcher
} from "./fetcher-common.ts";

const execFileAsync = promisify(execFile);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RetryOptions = {
  attempts: number;
  label: string;
  multiplier?: number;
  min?: number;
  max?: number;
};

async function withRetry<T>(fn: () => Promise<T>, { attempts, label, multiplier = 2, min = 2, max = 20 }: RetryOptions) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const backoff = Math.min(max, Math.max(min, multiplier * 2 ** (attempt - 1)));
      console.warn(
        `  ${label} failed (attempt ${attempt}/${attempts}): ${error instanceof Error ? error.message : error} — retrying in ${backoff}s`
      );
      await sleep(backoff * 1000);
    }
  }
  throw lastError;
}

export class Crawl4AIFetcher implements InventoryFetcher {
  readonly offline: boolean;
  private readonly pythonBin: string;
  private readonly scriptPath: string;

  constructor({ offline = false } = {}) {
    this.offline = offline;
    ensureCacheDir(offline);
    this.pythonBin = process.env.FLOWRYD_PYTHON ?? "python3";
    this.scriptPath = path.join(process.cwd(), "inventory-scraping", "crawl4ai", "fetch_page.py");
  }

  private async invoke(
    mode: "direct" | "api" | "html" | "stealth",
    url: string,
    cacheFile: string | null | undefined,
    extra: { waitFor?: string | null; waitMs?: number; politeDelayMs?: number } = {}
  ) {
    if (!cacheFile) {
      throw new Error("crawl4ai fetch requires cacheFile so offline re-parse can reuse the payload");
    }

    const args = ["--mode", mode, "--url", url, "--cache-file", cacheFile];
    if (extra.waitFor) args.push("--wait-for", extra.waitFor);
    if (extra.waitMs != null) args.push("--wait-ms", String(extra.waitMs));
    if (extra.politeDelayMs) args.push("--polite-delay-ms", String(extra.politeDelayMs));

    await execFileAsync(this.pythonBin, [this.scriptPath, ...args], {
      timeout: mode === "stealth" ? 180_000 : 120_000,
      maxBuffer: 64 * 1024 * 1024
    });

    return readCachedPayload(cacheFile, mode, false);
  }

  private recordFetch(method: FetchMethod, url: string, cacheFile: string | null | undefined, text: string, fromCache: boolean) {
    logFetch({
      fetcher: "crawl4ai",
      method,
      url,
      cacheFile: cacheFile ?? null,
      byteLength: text.length,
      fromCache,
      fetchedAt: new Date().toISOString()
    });
  }

  async fetchApi(url: string, { cacheFile = null }: CacheOptions = {}) {
    if (this.offline) {
      const text = readCachedPayload(cacheFile, "API page");
      this.recordFetch("api", url, cacheFile, text, true);
      return text;
    }
    return withRetry(
      async () => {
        const text = await this.invoke("api", url, cacheFile);
        writeCachedPayload(cacheFile, text);
        this.recordFetch("api", url, cacheFile, text, false);
        return text;
      },
      { attempts: 3, label: `crawl4ai fetch_api ${url}` }
    );
  }

  async fetchDirect(url: string, { cacheFile = null, politeDelayMs = 0 }: CacheOptions & { politeDelayMs?: number } = {}) {
    if (this.offline) {
      const text = readCachedPayload(cacheFile, "page");
      this.recordFetch("direct", url, cacheFile, text, true);
      return text;
    }
    return withRetry(
      async () => {
        const text = await this.invoke("direct", url, cacheFile, { politeDelayMs });
        writeCachedPayload(cacheFile, text);
        this.recordFetch("direct", url, cacheFile, text, false);
        return text;
      },
      { attempts: 3, label: `crawl4ai fetch_direct ${url}` }
    );
  }

  async fetchStealth(url: string, { cacheFile = null, waitMs = 8000 }: CacheOptions & { waitMs?: number } = {}) {
    if (this.offline) {
      const text = readCachedPayload(cacheFile, "stealth page");
      this.recordFetch("stealth", url, cacheFile, text, true);
      return text;
    }
    return withRetry(
      async () => {
        const text = await this.invoke("stealth", url, cacheFile, { waitMs });
        writeCachedPayload(cacheFile, text);
        this.recordFetch("stealth", url, cacheFile, text, false);
        return text;
      },
      { attempts: 2, label: `crawl4ai fetch_stealth ${url}` }
    );
  }

  async fetchHtml(url: string, { cacheFile = null, waitFor = null }: CacheOptions & { waitFor?: string | null } = {}) {
    if (this.offline) {
      const text = readCachedPayload(cacheFile, "HTML page");
      this.recordFetch("html", url, cacheFile, text, true);
      return text;
    }
    return withRetry(
      async () => {
        const text = await this.invoke("html", url, cacheFile, { waitFor, waitMs: 12_000 });
        writeCachedPayload(cacheFile, text);
        this.recordFetch("html", url, cacheFile, text, false);
        return text;
      },
      { attempts: 3, label: `crawl4ai fetch_html ${url}` }
    );
  }
}
