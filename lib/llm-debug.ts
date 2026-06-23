export function llmDebugEnabled() {
  return process.env.FLOWRYD_LLM_DEBUG === "1";
}

export function llmDebug(stage: string, details: Record<string, unknown>) {
  if (!llmDebugEnabled()) return;
  console.info(`[llm:${stage}] ${JSON.stringify(details)}`);
}
