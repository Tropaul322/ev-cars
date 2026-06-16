import inventoryRows from "../../data/flowryd_site/inventory.json" with { type: "json" };
import {
  normalizeFlowrydVehicle,
  type RawInventoryRow
} from "./flowryd-normalization.ts";
import { seedVehicles } from "./seed-vehicles.ts";

export const flowrydVehicles = (inventoryRows as RawInventoryRow[]).map(normalizeFlowrydVehicle);

/** Local inventory bundle used by upload scripts and as a deterministic runtime fallback. */
export const allVehicles = [...seedVehicles, ...flowrydVehicles];
