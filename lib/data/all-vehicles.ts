import inventoryRows from "../../data/flowryd_site/inventory.json" with { type: "json" };
import {
  normalizeFlowrydVehicle,
  type RawInventoryRow
} from "./flowryd-normalization.ts";
import { seedVehicles } from "./seed-vehicles.ts";

export const flowrydVehicles = (inventoryRows as RawInventoryRow[]).map(normalizeFlowrydVehicle);

/** Inventory bundle for upload/ingest scripts and unit-test fixtures (not used at runtime). */
export const allVehicles = [...seedVehicles, ...flowrydVehicles];
