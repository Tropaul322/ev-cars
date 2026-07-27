export type MatchingPipeline = "classic" | "light_hard";

export function matchingPipeline(): MatchingPipeline {
  const raw = process.env.FLOWRYD_MATCHING_PIPELINE?.trim().toLowerCase();
  if (raw === "classic" || raw === "light_hard") return raw;
  if (readBooleanEnv("FLOWRYD_LIGHT_HARD_MATCHING", false)) return "light_hard";
  return "classic";
}

export function lightHardMatchingEnabled() {
  return matchingPipeline() === "light_hard";
}

export function softenMatchPreferencesEnabled() {
  return lightHardMatchingEnabled() && readBooleanEnv("FLOWRYD_SOFTEN_MATCH_PREFERENCES", false);
}

export function vehicleStructuredSearchEnabled() {
  return readBooleanEnv("FLOWRYD_VEHICLE_STRUCTURED_SEARCH", true);
}

export function vehicleEmbeddingSearchEnabled() {
  if (process.env.FLOWRYD_DISABLE_EMBEDDINGS === "1") return false;
  if (process.env.FLOWRYD_ENABLE_VEHICLE_EMBEDDING_SEARCH === "1") return true;
  return readBooleanEnv("FLOWRYD_VEHICLE_EMBEDDING_SEARCH", false);
}

export function vehicleEmbeddingSearchLimit() {
  return readPositiveIntegerEnv("FLOWRYD_VEHICLE_EMBEDDING_SEARCH_LIMIT", 200);
}

export function vehicleEmbeddingMinSimilarity() {
  return readNumberEnv("FLOWRYD_VEHICLE_EMBEDDING_MIN_SIMILARITY", 0.1);
}

function readBooleanEnv(name: string, defaultValue: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return defaultValue;
}

function readPositiveIntegerEnv(name: string, defaultValue: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : defaultValue;
}

function readNumberEnv(name: string, defaultValue: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}
