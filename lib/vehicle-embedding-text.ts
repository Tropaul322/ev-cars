import type { Feature, Vehicle } from "./types.ts";
import { bodyTypeLexiconTokens, seatsLexiconTokens } from "./vehicle-search-lexicon.ts";

const featureLabels: Record<Feature, string> = {
  adaptive_cruise_control: "adaptive cruise control acc tempomat",
  android_auto: "android auto",
  apple_carplay: "apple carplay",
  awd: "awd allrad winter",
  blind_spot_detection: "blind spot detection totwinkel",
  cabin_storage: "cabin storage",
  heat_pump: "heat pump warmepumpe",
  heated_seats: "heated seats sitzheizung",
  lane_keeping_assist: "lane keeping assist spurhalteassistent",
  large_trunk: "large trunk cargo kofferraum",
  premium_audio: "premium audio sound",
  reliable_connectivity: "reliable connectivity ota bluetooth wifi",
  voice_assistant: "voice assistant sprachsteuerung",
  wireless_charging: "wireless charging"
};

export function vehicleTitle(vehicle: Vehicle) {
  return vehicle.title ?? `${vehicle.make} ${vehicle.model} ${vehicle.trim}`.trim();
}

export function buildVehicleEmbeddingText(vehicle: Vehicle) {
  const seatPhrases = seatsLexiconTokens(vehicle.seats).join(" ");
  const bodyPhrases = bodyTypeLexiconTokens(vehicle.bodyType).join(" ");
  return [
    vehicleTitle(vehicle),
    vehicle.brand,
    vehicle.make,
    vehicle.model,
    vehicle.trim,
    vehicle.year,
    vehicle.condition,
    bodyPhrases,
    seatPhrases,
    vehicle.drivetrain,
    vehicle.location,
    vehicle.listingCountry,
    vehicle.sellerType,
    vehicle.manufacturerCountry,
    vehicle.manufacturerCountryCode,
    `${vehicle.priceEUR} eur price`,
    `${vehicle.rangeKm} km range reichweite`,
    `${vehicle.efficiencyKwhPer100Km} kwh per 100 km efficiency`,
    `${vehicle.cargoLiters} cargo trunk kofferraum`,
    vehicle.mileageKm ? `${vehicle.mileageKm} km mileage` : null,
    vehicle.batterySoH ? `${vehicle.batterySoH}% battery health` : null,
    vehicle.features.map((feature) => featureLabels[feature]).join(" "),
    vehicle.notes,
    vehicle.warranty,
    vehicle.reviewTags.join(" "),
    vehicle.brandOrigin
  ]
    .filter(Boolean)
    .join(" ");
}
