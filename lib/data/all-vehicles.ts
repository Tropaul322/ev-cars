import inventoryRows from "../../data/flowryd_site/inventory.json" with { type: "json" };
import {
  normalizeFlowrydVehicle,
  type RawInventoryRow
} from "./flowryd-normalization.ts";
import { seedVehicles } from "./seed-vehicles.ts";

export const flowrydVehicles = (inventoryRows as RawInventoryRow[]).map(normalizeFlowrydVehicle);

const preferredFlowrydVehicles = preferStableListingImageVehicles(flowrydVehicles);

export const allVehicles = preferredFlowrydVehicles.length ? preferredFlowrydVehicles : seedVehicles;

function preferStableListingImageVehicles<T extends { source: string; images: string[] }>(vehicles: T[]) {
  const scrapedWithImages = vehicles.filter(
    (vehicle) => vehicle.source !== "seed" && hasListingImage(vehicle)
  );

  return scrapedWithImages.length ? scrapedWithImages : vehicles;
}

function hasListingImage(vehicle: { images: string[] }) {
  return vehicle.images.some((image) => /^https?:\/\//.test(image));
}
