import fs from "node:fs";
import path from "node:path";
import { normalizeCriteria } from "../lib/criteria-normalizer.ts";
import { buildExplanationInput } from "../lib/explanations.ts";
import { retrieveRagContext } from "../lib/rag.ts";
import type { RejectedSummary, RejectedVehicle, UserCriteria } from "../lib/types.ts";
import { getMatchSession } from "../lib/repositories/match-session-repository.ts";
import { listVehicles, searchVehicles } from "../lib/repositories/vehicle-repository.ts";
import { matchVehicles } from "../lib/scoring.ts";
import { vehicleMatchesModelPreferences } from "../lib/vehicle-matching.ts";

type InspectOptions = {
  message: string;
  sessionId?: string;
  disableLlmNormalizer: boolean;
};

const root = process.cwd();
for (const [key, value] of Object.entries(loadEnv(path.join(root, ".env.local")))) {
  if (typeof value === "string") process.env[key] = value;
}

const options = parseArgs(process.argv.slice(2));
if (options.disableLlmNormalizer) process.env.FLOWRYD_DISABLE_LLM = "1";

if (!options.message) {
  throw new Error("Provide a prompt with --message=\"...\" or as positional text.");
}

const storedSession = options.sessionId ? await getMatchSession(options.sessionId) : null;
const normalized = await normalizeCriteria({
  message: options.message,
  previousCriteria: storedSession?.criteria ?? null
});
const criteria = normalized.criteria;
const candidateVehicles = await searchVehicles(criteria);
const scoringVehicles = candidateVehicles.length ? candidateVehicles : await listVehicles();
const ragContext = await retrieveRagContext(options.message, criteria, scoringVehicles);
const result = matchVehicles(scoringVehicles, criteria, 8, { ragContext });
const rejectedSummary = summarizeRejected(result.rejected, criteria);
const context = buildExplanationInput(result.recommendations.slice(0, 8), criteria, rejectedSummary);

const outputPath = path.join(root, "data", "debug", "ai-context.latest.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      inspectedAt: new Date().toISOString(),
      message: options.message,
      normalization: {
        confidence: normalized.confidence,
        missingCriteria: normalized.missingCriteria,
        criteriaPatch: normalized.criteriaPatch
      },
      ragSummary: {
        query: ragContext.query,
        topicAffinity: ragContext.topicAffinity,
        documentCount: ragContext.documents.length,
        vehicleEvidenceCount: Object.keys(ragContext.vehicleEvidence).length
      },
      explanationInput: context
    },
    null,
    2
  )}\n`
);

console.log(`Wrote ${outputPath}`);
console.log(
  JSON.stringify(
    {
      language: context.language,
      criteriaSummary: context.criteriaSummary,
      rejectedSummary: context.rejectedSummary,
      ragTopicAffinity: ragContext.topicAffinity,
      matches: context.matches.map((match) => ({
        vehicleId: match.vehicleId,
        vehicle: `${match.vehicle.make} ${match.vehicle.model}`,
        score: match.score,
        evidence: match.retrievedEvidence.map((evidence) => ({
          evidenceId: evidence.evidenceId,
          topic: evidence.topic,
          title: evidence.title,
          score: evidence.score,
          excerpt: evidence.excerpt.slice(0, 180)
        }))
      }))
    },
    null,
    2
  )
);

function summarizeRejected(rejected: RejectedVehicle[], criteria: UserCriteria): RejectedSummary[] {
  const focusedRejected =
    criteria.modelPreferences.length &&
    rejected.some((item) => vehicleMatchesModelPreferences(item.vehicle, criteria.modelPreferences))
      ? rejected.filter((item) => vehicleMatchesModelPreferences(item.vehicle, criteria.modelPreferences))
      : rejected;
  const counts = new Map<string, number>();
  for (const item of focusedRejected) {
    for (const reason of item.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
}

function parseArgs(args: string[]): InspectOptions {
  let message = "";
  let sessionId: string | undefined;
  let disableLlmNormalizer = false;

  for (const arg of args) {
    if (arg.startsWith("--message=")) {
      message = arg.slice("--message=".length);
    } else if (arg.startsWith("--session-id=")) {
      sessionId = arg.slice("--session-id=".length);
    } else if (arg === "--disable-llm-normalizer") {
      disableLlmNormalizer = true;
    } else if (!arg.startsWith("--")) {
      message = [message, arg].filter(Boolean).join(" ");
    }
  }

  return { message: message.trim(), sessionId, disableLlmNormalizer };
}

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return process.env;
  const values: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return values;
}
