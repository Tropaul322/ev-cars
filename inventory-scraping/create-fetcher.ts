import { Crawl4AIFetcher } from "./crawl4ai-fetcher.ts";
import type { FetcherKind, InventoryFetcher } from "./fetcher-common.ts";
import { ScrapingBeeFetcher } from "./scrapingbee.ts";

export function createInventoryFetcher(kind: FetcherKind, offline: boolean): InventoryFetcher {
  if (kind === "crawl4ai") return new Crawl4AIFetcher({ offline });
  return new ScrapingBeeFetcher({ offline });
}
