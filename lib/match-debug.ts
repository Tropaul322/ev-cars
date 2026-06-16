export function matchDebug(stage: string, details: Record<string, unknown>) {
  if (process.env.FLOWRYD_MATCH_DEBUG !== "1") return;
  console.info(`[match:${stage}] ${JSON.stringify(details)}`);
}

export function matchDebugWarn(stage: string, details: Record<string, unknown>) {
  if (process.env.FLOWRYD_MATCH_DEBUG !== "1") return;
  console.warn(`[match:${stage}] ${JSON.stringify(details)}`);
}
