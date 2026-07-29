/** User-facing inventory copy — avoid the word "listing". */

export function formatMatchInventoryLabel(modelCount: number, _matchCount: number) {
  const models = `${modelCount} model${modelCount === 1 ? "" : "s"}`;
  return `${models} • matching found`;
}

export function formatSeeMatchesLabel(matchCount: number) {
  return `See ${matchCount} matching`;
}
