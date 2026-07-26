/** User-facing inventory copy — avoid the word "listing". */

export function formatMatchInventoryLabel(modelCount: number, matchCount: number) {
  const models = `${modelCount} model${modelCount === 1 ? "" : "s"}`;
  const matching = `${matchCount} matching found`;
  return `${models} • ${matching}`;
}

export function formatSeeMatchesLabel(matchCount: number) {
  return `See ${matchCount} matching`;
}
