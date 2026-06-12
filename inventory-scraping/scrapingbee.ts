// ScrapingBee fetcher (TS port of the PoC fetcher).
//
// Three fetch modes, matching what each source needs:
//   fetchDirect  - plain browser-style request, no proxy (AutoScout24, bmw-boerse)
//   fetchApi     - JSON endpoints; escalates standard -> premium -> stealth proxy (Tesla)
//   fetchStealth - full JS render through stealth residential proxies (willhaben/DataDome)
//   fetchHtml    - JS render via standard proxy with stealth fallback (generic/RAG pages)
import {
  ensureCacheDir,
  readCachedPayload,
  writeCachedPayload,
  type CacheOptions,
  type InventoryFetcher
} from "./fetcher-common.ts";

export { cacheFilePath, rawHtmlCacheDir, safeFilename } from "./fetcher-common.ts";

const SCRAPINGBEE_ENDPOINT = "https://app.scrapingbee.com/api/v1/";
const PRE_RE = /<pre[^>]*>([\s\S]*?)<\/pre>/i;

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&apos;": "'"
};

function unescapeHtml(text: string) {
  return text.replace(/&(amp|lt|gt|quot|#39|#x27|apos);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
}

function unwrapJson(text: string) {
  const match = PRE_RE.exec(text);
  return match ? unescapeHtml(match[1]) : text;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "de-AT,de;q=0.9,en;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1"
};

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

export class ScrapingBeeFetcher implements InventoryFetcher {
  readonly offline: boolean;
  private resolvedApiKey: string | null = null;

  constructor({ offline = false } = {}) {
    this.offline = offline;
    ensureCacheDir(offline);
  }

  private get apiKey() {
    if (this.resolvedApiKey) return this.resolvedApiKey;
    const key = process.env.SCRAPINGBEE_API_KEY;
    if (!key || key === "replace_me") {
      throw new Error("Missing SCRAPINGBEE_API_KEY in environment (not needed for --offline).");
    }
    this.resolvedApiKey = key;
    return key;
  }

  private async get(url: string, params: Record<string, string>) {
    const qs = new URLSearchParams({ api_key: this.apiKey, url, ...params });
    const response = await fetch(`${SCRAPINGBEE_ENDPOINT}?${qs.toString()}`, {
      signal: AbortSignal.timeout(90_000)
    });
    const text = await response.text();
    if (response.status >= 400) {
      throw new Error(`ScrapingBee fetch failed: ${response.status} for ${url}`);
    }
    return text;
  }

  async fetchApi(url: string, { cacheFile = null }: CacheOptions = {}) {
    if (this.offline) return readCachedPayload(cacheFile, "API page");

    for (const [label, params] of [
      ["standard", { render_js: "false", country_code: "at" }],
      ["premium", { render_js: "false", premium_proxy: "true", country_code: "at" }]
    ] as const) {
      try {
        const text = unwrapJson(await this.get(url, params));
        writeCachedPayload(cacheFile, text);
        return text;
      } catch (error) {
        console.warn(`  API fetch failed on ${label} proxy (${error instanceof Error ? error.message : error}); trying next proxy`);
      }
    }

    const text = unwrapJson(await this.get(url, { render_js: "false", stealth_proxy: "true" }));
    const head = text.replace(/^\s+/, "").slice(0, 200).toLowerCase();
    if (head.startsWith("{") && head.includes('"error"') && !head.includes('"results"')) {
      throw new Error("stealth proxy returned an error payload (bot-blocked)");
    }
    writeCachedPayload(cacheFile, text);
    return text;
  }

  async fetchDirect(url: string, { cacheFile = null, politeDelayMs = 0 }: CacheOptions & { politeDelayMs?: number } = {}) {
    if (this.offline) return readCachedPayload(cacheFile, "page");

    return withRetry(
      async () => {
        if (politeDelayMs) await sleep(politeDelayMs);
        const response = await fetch(url, {
          headers: BROWSER_HEADERS,
          redirect: "follow",
          signal: AbortSignal.timeout(30_000)
        });
        const text = await response.text();
        if (response.status >= 400) {
          throw new Error(`direct fetch failed: ${response.status} for ${url}`);
        }
        writeCachedPayload(cacheFile, text);
        return text;
      },
      { attempts: 3, label: `fetch_direct ${url}` }
    );
  }

  async fetchStealth(url: string, { cacheFile = null, waitMs = 8000 }: CacheOptions & { waitMs?: number } = {}) {
    if (this.offline) return readCachedPayload(cacheFile, "stealth page");

    return withRetry(
      async () => {
        const text = await this.get(url, { render_js: "true", stealth_proxy: "true", wait: String(waitMs) });
        writeCachedPayload(cacheFile, text);
        return text;
      },
      { attempts: 2, label: `fetch_stealth ${url}` }
    );
  }

  async fetchHtml(url: string, { cacheFile = null, waitFor = null }: CacheOptions & { waitFor?: string | null } = {}) {
    if (this.offline) return readCachedPayload(cacheFile, "HTML page");

    return withRetry(
      async () => {
        const params: Record<string, string> = { render_js: "true", country_code: "at", block_resources: "false" };
        if (waitFor) params.wait_for = waitFor;

        try {
          const text = await this.get(url, params);
          writeCachedPayload(cacheFile, text);
          return text;
        } catch (error) {
          console.warn(
            `  standard fetch failed (${error instanceof Error ? error.message : error}); retrying with stealth proxy`
          );
          const stealth: Record<string, string> = { render_js: "true", block_resources: "false", stealth_proxy: "true" };
          if (waitFor) stealth.wait_for = waitFor;
          const text = await this.get(url, stealth);
          writeCachedPayload(cacheFile, text);
          return text;
        }
      },
      { attempts: 3, label: `fetch_html ${url}` }
    );
  }
}
