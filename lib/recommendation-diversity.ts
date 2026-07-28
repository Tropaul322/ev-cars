import type { MatchResult, Vehicle } from "./types.ts";
import { vehiclePrimaryMatchKey } from "./match-diagnostics.ts";

export type DiversifyRecommendationsOptions = {
  maxPerModel: number;
  maxPerListing: number;
  maxPerBrand: number;
};

/**
 * Prefer score order while capping duplicates by listing, model, and brand.
 * A second pass fills remaining slots when the pool is thin (same brand allowed).
 */
export function diversifyRecommendations(
  matches: MatchResult[],
  limit: number,
  options: DiversifyRecommendationsOptions
) {
  const { maxPerModel, maxPerListing, maxPerBrand } = options;
  const selected: MatchResult[] = [];
  const modelCounts = new Map<string, number>();
  const listingCounts = new Map<string, number>();
  const brandCounts = new Map<string, number>();
  const selectedIds = new Set<string>();

  for (const match of matches) {
    if (selected.length >= limit) break;
    const modelKey = vehicleModelKey(match.vehicle);
    const listingKey = vehiclePrimaryMatchKey(match.vehicle);
    const brandKey = vehicleBrandKey(match.vehicle);
    const modelCount = modelCounts.get(modelKey) ?? 0;
    const listingCount = listingCounts.get(listingKey) ?? 0;
    const brandCount = brandCounts.get(brandKey) ?? 0;
    if (modelCount >= maxPerModel) continue;
    if (listingCount >= maxPerListing) continue;
    if (brandCount >= maxPerBrand) continue;
    selected.push(match);
    selectedIds.add(match.vehicle.id);
    modelCounts.set(modelKey, modelCount + 1);
    listingCounts.set(listingKey, listingCount + 1);
    brandCounts.set(brandKey, brandCount + 1);
  }

  if (selected.length < limit) {
    const fillPasses: Array<"prefer-new-brand" | "any"> = ["prefer-new-brand", "any"];
    for (const pass of fillPasses) {
      for (const match of matches) {
        if (selected.length >= limit) break;
        if (selectedIds.has(match.vehicle.id)) continue;
        const listingKey = vehiclePrimaryMatchKey(match.vehicle);
        if ((listingCounts.get(listingKey) ?? 0) >= maxPerListing) continue;
        const brandKey = vehicleBrandKey(match.vehicle);
        if (pass === "prefer-new-brand" && (brandCounts.get(brandKey) ?? 0) > 0) continue;
        selected.push(match);
        selectedIds.add(match.vehicle.id);
        listingCounts.set(listingKey, (listingCounts.get(listingKey) ?? 0) + 1);
        brandCounts.set(brandKey, (brandCounts.get(brandKey) ?? 0) + 1);
        const modelKey = vehicleModelKey(match.vehicle);
        modelCounts.set(modelKey, (modelCounts.get(modelKey) ?? 0) + 1);
      }
    }
  }

  return selected;
}

export function vehicleModelKey(vehicle: Pick<Vehicle, "make" | "model">) {
  return `${vehicle.make} ${vehicle.model}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function vehicleBrandKey(vehicle: Pick<Vehicle, "make">) {
  return vehicle.make.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveMaxPerBrand(brandPreferences: string[] | undefined, maxPerBrand: number) {
  return brandPreferences?.length ? Number.POSITIVE_INFINITY : maxPerBrand;
}
