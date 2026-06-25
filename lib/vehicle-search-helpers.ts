import type { UserCriteria } from "./types.ts";
import { vehicleEmbeddingSearchEnabled } from "./vehicle-search-settings.ts";

export const MIN_PLAUSIBLE_PURCHASE_PRICE_EUR = 3500;
export const HARD_MIN_PURCHASE_PRICE_EUR = 1000;

export function inferSearchRangeFloorKm(criteria: UserCriteria) {
  return criteria.rangeFloorKm;
}

export function isPlausiblePurchasePrice(priceEUR: number, monthlyLeaseEUR: number | null | undefined) {
  if (priceEUR < HARD_MIN_PURCHASE_PRICE_EUR) return false;
  if (priceEUR < MIN_PLAUSIBLE_PURCHASE_PRICE_EUR && !monthlyLeaseEUR) return false;
  return true;
}

export function resolveVehicleSearchOrder(criteria: UserCriteria) {
  const rangeFocused =
    Boolean(criteria.rangeFloorKm) ||
    Boolean(inferSearchRangeFloorKm(criteria)) ||
    criteria.tripNeeds.some((need) => need === "road_trip" || need === "family");

  if (vehicleEmbeddingSearchEnabled()) {
    return rangeFocused ? "range_km.desc,price_eur.asc" : "price_eur.asc,range_km.desc";
  }

  if (rangeFocused || criteria.brandPreferences.length || criteria.modelPreferences.length) {
    return "range_km.desc,price_eur.asc";
  }

  return "range_km.desc,price_eur.asc";
}
