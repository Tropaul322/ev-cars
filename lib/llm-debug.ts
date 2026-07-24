export function llmDebugEnabled() {
  return process.env.FLOWRYD_LLM_DEBUG === "1";
}

/** Always-on status log for each LLM call (ok/error, model, latency). */
export function llmCallLog(stage: string, details: Record<string, unknown>) {
  console.info(`[llm:${stage}] ${JSON.stringify(details)}`);
}

/** Verbose LLM payload dump; only when FLOWRYD_LLM_DEBUG=1. */
export function llmDebug(stage: string, details: Record<string, unknown>) {
  if (!llmDebugEnabled()) return;
  console.info(`[llm:${stage}:debug] ${JSON.stringify(details)}`);
}
