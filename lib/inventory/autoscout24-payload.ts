import type { Vehicle } from "../types.ts";
import { prepareWillhabenVehicleForUpload, type WillhabenInventoryRow } from "./willhaben-payload.ts";

export type Autoscout24InventoryRow = WillhabenInventoryRow;

/** AutoScout24 scrape rows already match the vehicle payload shape; reuse Willhaben normalization. */
export function prepareAutoscout24VehicleForUpload(row: Autoscout24InventoryRow): Vehicle {
  return prepareWillhabenVehicleForUpload({
    ...row,
    source: row.source ?? "autoscout24"
  });
}
