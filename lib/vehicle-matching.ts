import type { Vehicle } from "./types.ts";

export function vehicleMatchesModelPreferences(vehicle: Vehicle, modelPreferences: string[]) {
  return !modelPreferences.length || modelPreferences.some((model) => vehicleMatchesModelPreference(vehicle, model));
}

export function vehicleMatchesModelPreference(vehicle: Vehicle, modelPreference: string) {
  const preferred = normalizeVehicleText(modelPreference);
  if (!preferred) return false;

  const searchable = normalizeVehicleText(
    [
      vehicle.make,
      vehicle.model,
      vehicle.trim,
      vehicle.title,
      `${vehicle.make} ${vehicle.model}`,
      `${vehicle.model} ${vehicle.trim}`
    ]
      .filter(Boolean)
      .join(" ")
  );

  const paddedSearchable = ` ${searchable} `;
  const paddedPreferred = ` ${preferred} `;
  return paddedSearchable.includes(paddedPreferred);
}

function normalizeVehicleText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
