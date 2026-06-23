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
