import type { Feature, Vehicle } from "./types.ts";

const canonicalFeatures = new Set<Feature>([
  "apple_carplay",
  "android_auto",
  "blind_spot_detection",
  "adaptive_cruise_control",
  "lane_keeping_assist",
  "wireless_charging",
  "reliable_connectivity",
  "voice_assistant",
  "cabin_storage",
  "heated_seats",
  "large_trunk",
  "premium_audio",
  "heat_pump",
  "awd"
]);

const featureLabelPatterns: Array<[Feature, RegExp]> = [
  ["apple_carplay", /\b(apple\s*carplay|carplay)\b/i],
  ["android_auto", /\b(android\s*auto)\b/i],
  ["blind_spot_detection", /\b(blind[- ]spot|totwinkel|toter winkel)\b/i],
  ["adaptive_cruise_control", /\badaptive cruise\b/i],
  ["lane_keeping_assist", /\b(lane (keeping|departure|assist)|spurhalte|spurassistent)\b/i],
  ["wireless_charging", /\b(wireless charg|kabellos laden|induktiv laden)\b/i],
  ["heated_seats", /\b(seat heat(?:ing)?|heated seat|sitzheizung|beheizte sitze)\b/i],
  ["premium_audio", /\b(bose|harman|bowers|burmester|premium audio|premium sound)\b/i],
  ["heat_pump", /\b(heat pump|wärmepumpe|waermepumpe)\b/i],
  ["awd", /\b(all[- ]wheel|awd|4x4|4matic|quattro|xdrive|4motion)\b/i],
  ["voice_assistant", /\b(voice assistant|sprachassistent|sprachsteuerung)\b/i],
  ["reliable_connectivity", /\b(bluetooth|wi-?fi|wlan|usb[- ]c|connectivity|konnektivität)\b/i],
  ["cabin_storage", /\b(cabin storage|ablage|armlehne)\b/i],
  ["large_trunk", /\b(large trunk|big boot|großer kofferraum|grosser kofferraum)\b/i]
];

export type VehicleFeatureHints = Pick<Vehicle, "drivetrain" | "cargoLiters" | "bodyType">;

export function isCanonicalFeature(value: string): value is Feature {
  return canonicalFeatures.has(value as Feature);
}

export function normalizeVehicleFeatures(raw: string[], hints?: Partial<VehicleFeatureHints>): Feature[] {
  const features = new Set<Feature>();

  for (const item of raw) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (isCanonicalFeature(trimmed)) {
      features.add(trimmed);
      continue;
    }
    for (const [feature, pattern] of featureLabelPatterns) {
      if (pattern.test(trimmed)) features.add(feature);
    }
  }

  if (hints?.drivetrain === "AWD") features.add("awd");
  if (
    (hints?.cargoLiters ?? 0) >= 500 ||
    hints?.bodyType === "wagon" ||
    hints?.bodyType === "van"
  ) {
    features.add("large_trunk");
  }

  return [...features];
}

export function vehicleHasFeature(
  raw: string[],
  feature: Feature,
  hints?: Partial<VehicleFeatureHints>
) {
  return normalizeVehicleFeatures(raw, hints).includes(feature);
}
