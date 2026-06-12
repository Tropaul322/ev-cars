import type { InventoryFetcher } from "../fetcher-common.ts";
import type { InventorySourceConfig, RawListing } from "../types.ts";
import { fetchAutoscout24Listings } from "./autoscout24.ts";
import { fetchBmwBoerseListings } from "./bmw-boerse.ts";
import type { ParserContext } from "./common.ts";
import { fetchGenericVehicleListings } from "./generic-vehicle.ts";
import { fetchTeslaListings } from "./tesla.ts";
import { fetchWillhabenListings } from "./willhaben.ts";

export { parseRagPage } from "./rag-page.ts";

type InventoryParser = (
  source: InventorySourceConfig,
  fetcher: InventoryFetcher,
  context: ParserContext
) => Promise<RawListing[]>;

const inventoryParsers: Record<string, InventoryParser> = {
  autoscout24: fetchAutoscout24Listings,
  willhaben: fetchWillhabenListings,
  tesla_api: fetchTeslaListings,
  bmw_boerse: fetchBmwBoerseListings,
  generic_vehicle: fetchGenericVehicleListings
};

export function inventoryParserFor(source: InventorySourceConfig): InventoryParser | null {
  if (!source.parser || source.parser === "rag_page") return null;
  return inventoryParsers[source.parser] ?? null;
}

// Marketplace sources whose ToS/robots.txt restrict automated querying are
// hard-blocked unless the operator explicitly confirmed permission.
const permissionGatedSources = new Set(["willhaben", "autoscout24", "autoscout24_at", "gebrauchtwagen", "gebrauchtwagen_at"]);

export function assertSourcePermitted(source: InventorySourceConfig) {
  if (!source.parser) return;
  if (permissionGatedSources.has(source.source) && !source.permissionConfirmed) {
    throw new Error(
      `${source.id} is permission-gated (marketplace ToS/robots.txt). Set permissionConfirmed: true in its config entry only with operator authorization.`
    );
  }
}
