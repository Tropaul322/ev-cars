/**
 * Live multi-turn conversation regression for FlowRyd chat/matching.
 *
 * Runs realistic assistant scenarios through runMatchRequest with LLM enabled
 * (when OPENAI_API_KEY is set), scores naturalness heuristics, and writes a
 * JSON report under /opt/cursor/artifacts (or --out).
 *
 * Usage:
 *   node --experimental-strip-types scripts/run-conversation-regression.ts
 *   FLOWRYD_DISABLE_LLM=1 node --experimental-strip-types scripts/run-conversation-regression.ts
 */
import fs from "node:fs";
import path from "node:path";
import { runMatchRequest } from "../lib/match-service.ts";
import type { ClarificationPrompt, MatchResponse, UserCriteria } from "../lib/types.ts";

type TurnExpectation = {
  /** Expected response type(s). */
  types?: Array<MatchResponse["type"]>;
  /** Assistant message must match at least one of these. */
  messageIncludes?: RegExp[];
  /** Assistant message must not match any of these. */
  messageExcludes?: RegExp[];
  /** Expected clarification prompt key when type is clarification. */
  promptKey?: ClarificationPrompt["key"];
  /** Require at least one recommendation when type is matches. */
  requireRecommendations?: boolean;
  /** Soft naturalness checks — failures are warnings, not hard fails. */
  soft?: {
    maxMessageLength?: number;
    avoidFormLanguage?: boolean;
    avoidReintroduce?: boolean;
  };
};

type ScenarioTurn = {
  message: string;
  /** If true, auto-answer an optimization chip with best_value when present. */
  autoAnswerOptimization?: boolean;
  criteriaPatch?: MatchResponse extends never ? never : Record<string, unknown>;
  intent?: "show_matches" | "show_alternatives";
  expect: TurnExpectation;
};

type Scenario = {
  id: string;
  description: string;
  turns: ScenarioTurn[];
};

type TurnResult = {
  turnIndex: number;
  message: string;
  type: MatchResponse["type"];
  assistantMessage: string;
  promptKey?: string;
  recommendationCount: number;
  topVehicle?: string;
  hardPass: boolean;
  hardFailures: string[];
  softWarnings: string[];
  criteriaSnapshot: Partial<UserCriteria>;
};

type ScenarioResult = {
  id: string;
  description: string;
  passed: boolean;
  turns: TurnResult[];
};

const FORM_LANGUAGE =
  /\b(hard limit|purchase-price range|pick a range below|tap (an )?option|choose from the buttons|select below|wähle (eine|unten)|harte Grenze)\b/i;

const REINTRODUCE =
  /\b(I'?m FlowRyd|Ich bin FlowRyd|your EV match-maker|dein E-Auto-Matchmaker)\b/i;

const scenarios: Scenario[] = [
  {
    id: "greeting-then-shop",
    description: "Casual hello, then start shopping without feeling like a form",
    turns: [
      {
        message: "Hey! How's it going?",
        expect: {
          types: ["chat"],
          messageExcludes: [FORM_LANGUAGE, /budget works for you/i],
          soft: { maxMessageLength: 350, avoidFormLanguage: true }
        }
      },
      {
        message: "I need a compact EV for Vienna under 35k, used is fine, mostly city driving.",
        autoAnswerOptimization: true,
        expect: {
          types: ["clarification", "matches"],
          soft: { avoidFormLanguage: true, avoidReintroduce: true }
        }
      }
    ]
  },
  {
    id: "complete-first-message",
    description: "Rich first message should not feel stuck in endless chips",
    turns: [
      {
        message:
          "Looking for a family SUV EV, budget up to 50000 EUR, home wallbox, need about 450 km range, mostly Autobahn and kids.",
        autoAnswerOptimization: true,
        expect: {
          types: ["clarification", "matches"],
          soft: { avoidFormLanguage: true }
        }
      }
    ]
  },
  {
    id: "ev-knowledge-aside",
    description: "EV knowledge question mid-flow should answer, not force chips",
    turns: [
      {
        message: "Budget around 40000 EUR for a used EV.",
        expect: {
          types: ["clarification", "chat"],
          soft: { avoidReintroduce: false }
        }
      },
      {
        message: "How important is a heat pump in Austrian winters?",
        expect: {
          types: ["chat"],
          messageExcludes: [/budget works for you/i],
          soft: { avoidFormLanguage: true, avoidReintroduce: true, maxMessageLength: 600 }
        }
      }
    ]
  },
  {
    id: "german-family-search",
    description: "German multi-turn family search with alternatives",
    turns: [
      {
        message:
          "Hallo, ich suche einen Familien-SUV bis 50000 Euro, grosser Kofferraum, mindestens 450 km Reichweite.",
        autoAnswerOptimization: true,
        expect: {
          types: ["clarification", "matches"],
          soft: { avoidFormLanguage: true }
        }
      },
      {
        message: "Zeig mir Alternativen",
        expect: {
          types: ["matches", "chat", "no_matches"],
          soft: { avoidReintroduce: true }
        }
      }
    ]
  },
  {
    id: "brand-pivot",
    description: "Show matches then pivot to a specific brand",
    turns: [
      {
        message: "American EV like Ford or Tesla around 35k with good road-trip range",
        autoAnswerOptimization: true,
        expect: {
          types: ["clarification", "matches"],
          requireRecommendations: true
        }
      },
      {
        message: "What about Ford?",
        expect: {
          types: ["matches", "no_matches", "clarification"],
          soft: { avoidReintroduce: true }
        }
      }
    ]
  },
  {
    id: "capability-then-criteria",
    description: "Ask what the assistant can do, then share preferences",
    turns: [
      {
        message: "What can you do?",
        expect: {
          types: ["chat"],
          messageIncludes: [/FlowRyd|EV|E-Auto|budget|match/i],
          messageExcludes: [/budget works for you/i],
          soft: { avoidFormLanguage: true }
        }
      },
      {
        message: "Find me something sporty under 45000 with at least 400 km range.",
        autoAnswerOptimization: true,
        expect: {
          types: ["clarification", "matches"],
          soft: { avoidReintroduce: true }
        }
      }
    ]
  },
  {
    id: "impossible-budget-graceful",
    description: "Impossible constraints should explain blockers kindly",
    turns: [
      {
        message: "I need a brand new SUV with 600 km range for 15000 EUR.",
        autoAnswerOptimization: true,
        expect: {
          types: ["clarification", "no_matches", "matches", "chat"],
          soft: { avoidFormLanguage: true }
        }
      }
    ]
  },
  {
    id: "why-this-car",
    description: "After a match, ask why it was recommended",
    turns: [
      {
        message: "Compact city EV under 30000 EUR, CarPlay, mostly short trips in Graz.",
        autoAnswerOptimization: true,
        expect: {
          types: ["clarification", "matches"],
          requireRecommendations: true
        }
      },
      {
        message: "Why did you recommend this one?",
        expect: {
          types: ["chat", "matches"],
          soft: { avoidFormLanguage: true, avoidReintroduce: true, maxMessageLength: 700 }
        }
      }
    ]
  },
  {
    id: "thanks-midstream",
    description: "Thanks mid-conversation should stay light, not restart the form",
    turns: [
      {
        message: "My budget is about 40000 EUR.",
        expect: { types: ["clarification", "chat"] }
      },
      {
        message: "Thanks!",
        expect: {
          types: ["chat"],
          messageExcludes: [/budget works for you/i, /What budget/i],
          soft: { avoidFormLanguage: true, avoidReintroduce: true, maxMessageLength: 280 }
        }
      }
    ]
  },
  {
    id: "show-them-after-discuss",
    description: "User says show them after discussing preferences",
    turns: [
      {
        message: "Something efficient for commuting, budget 38000, home charging.",
        autoAnswerOptimization: true,
        expect: {
          types: ["clarification", "matches"],
          requireRecommendations: true
        }
      },
      {
        message: "Ok can you show them?",
        expect: {
          types: ["matches"],
          requireRecommendations: true,
          soft: { avoidReintroduce: true }
        }
      }
    ]
  },
  {
    id: "no-tesla-winter",
    description: "Avoid Tesla, winter/AWD needs",
    turns: [
      {
        message:
          "EV up to 56000 for mountains and winter, AWD, heated seats, 450 km range, no Tesla please.",
        autoAnswerOptimization: true,
        expect: {
          types: ["clarification", "matches"],
          soft: { avoidFormLanguage: true }
        }
      }
    ]
  },
  {
    id: "vague-to-specific",
    description: "Vague start then progressive refinement feels natural",
    turns: [
      {
        message: "I want an electric car.",
        expect: {
          types: ["clarification", "chat"],
          soft: { avoidFormLanguage: true }
        }
      },
      {
        message: "Around 40 to 50 thousand, for a family of 4.",
        expect: {
          types: ["clarification", "matches", "chat"],
          soft: { avoidReintroduce: true, avoidFormLanguage: true }
        }
      },
      {
        message: "Prefer an SUV and home wallbox.",
        autoAnswerOptimization: true,
        expect: {
          types: ["clarification", "matches", "chat"],
          soft: { avoidReintroduce: true }
        }
      }
    ]
  }
];

function summarizeCriteria(criteria: UserCriteria): Partial<UserCriteria> {
  return {
    language: criteria.language,
    budgetMinEUR: criteria.budgetMinEUR,
    budgetMaxEUR: criteria.budgetMaxEUR,
    rangeFloorKm: criteria.rangeFloorKm,
    bodyTypes: criteria.bodyTypes,
    tripNeeds: criteria.tripNeeds,
    chargingAccess: criteria.chargingAccess,
    brandPreferences: criteria.brandPreferences,
    avoidedBrands: criteria.avoidedBrands,
    mustHaveFeatures: criteria.mustHaveFeatures,
    optimizationDirective: criteria.optimizationDirective,
    preferredCondition: criteria.preferredCondition
  };
}

function evaluateTurn(
  turn: ScenarioTurn,
  response: MatchResponse,
  turnIndex: number,
  hadPriorAssistant: boolean
): TurnResult {
  const hardFailures: string[] = [];
  const softWarnings: string[] = [];
  const expect = turn.expect;
  const message = response.assistantMessage ?? response.message ?? "";

  if (expect.types && !expect.types.includes(response.type)) {
    hardFailures.push(`expected type in [${expect.types.join(", ")}], got ${response.type}`);
  }
  if (expect.promptKey) {
    const promptKey = "prompt" in response ? response.prompt?.key : undefined;
    if (promptKey !== expect.promptKey) {
      hardFailures.push(`expected promptKey=${expect.promptKey}, got ${promptKey ?? "none"}`);
    }
  }
  if (expect.requireRecommendations) {
    const count =
      response.type === "matches"
        ? response.recommendations.length
        : 0;
    if (count < 1 && response.type === "matches") {
      hardFailures.push("expected recommendations but got none");
    }
    // If we required recs and never got matches type, that's also a failure unless types allowed others
    if (response.type !== "matches" && expect.types?.includes("matches") && expect.types.length === 1) {
      hardFailures.push("expected matches with recommendations");
    }
  }
  for (const pattern of expect.messageIncludes ?? []) {
    if (!pattern.test(message)) {
      hardFailures.push(`message missing pattern ${pattern}`);
    }
  }
  for (const pattern of expect.messageExcludes ?? []) {
    if (pattern.test(message)) {
      hardFailures.push(`message matched excluded pattern ${pattern}`);
    }
  }

  const soft = expect.soft ?? {};
  if (soft.maxMessageLength && message.length > soft.maxMessageLength) {
    softWarnings.push(`message length ${message.length} > ${soft.maxMessageLength}`);
  }
  if (soft.avoidFormLanguage && FORM_LANGUAGE.test(message)) {
    softWarnings.push("form-like language detected");
  }
  if (soft.avoidReintroduce && hadPriorAssistant && REINTRODUCE.test(message)) {
    softWarnings.push("re-introduced FlowRyd mid-conversation");
  }
  if (!message.trim()) {
    hardFailures.push("empty assistant message");
  }

  const top =
    response.type === "matches" && response.recommendations[0]
      ? `${response.recommendations[0].vehicle.make} ${response.recommendations[0].vehicle.model}`
      : undefined;

  return {
    turnIndex,
    message: turn.message,
    type: response.type,
    assistantMessage: message,
    promptKey: "prompt" in response ? response.prompt?.key : undefined,
    recommendationCount: response.recommendations?.length ?? 0,
    topVehicle: top,
    hardPass: hardFailures.length === 0,
    hardFailures,
    softWarnings,
    criteriaSnapshot: summarizeCriteria(response.criteria)
  };
}

async function maybeAnswerOptimization(
  response: MatchResponse,
  turn: ScenarioTurn
): Promise<MatchResponse> {
  if (!turn.autoAnswerOptimization) return response;
  if (response.type !== "clarification" || response.prompt?.key !== "optimization") {
    return response;
  }
  return runMatchRequest({
    message: "Best value",
    sessionId: response.sessionId,
    previousCriteria: response.criteria,
    criteriaPatch: { optimizationDirective: "best_value" },
    currentPromptKey: "optimization"
  });
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const turns: TurnResult[] = [];
  let previous: MatchResponse | null = null;
  let conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  let hadPriorAssistant = false;

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i]!;
    let response = await runMatchRequest({
      message: turn.message,
      sessionId: previous?.sessionId,
      previousCriteria: previous?.criteria,
      currentPromptKey: previous && "prompt" in previous ? previous.prompt?.key : undefined,
      intent: turn.intent,
      conversationHistory,
      ...(turn.criteriaPatch ? { criteriaPatch: turn.criteriaPatch as never } : {})
    });

    response = await maybeAnswerOptimization(response, turn);

    const evaluated = evaluateTurn(turn, response, i, hadPriorAssistant);
    turns.push(evaluated);

    conversationHistory = [
      ...conversationHistory,
      { role: "user" as const, content: turn.message },
      { role: "assistant" as const, content: response.assistantMessage ?? response.message ?? "" }
    ].slice(-14);

    previous = response;
    hadPriorAssistant = true;
  }

  return {
    id: scenario.id,
    description: scenario.description,
    passed: turns.every((t) => t.hardPass),
    turns
  };
}

function printReport(results: ScenarioResult[]) {
  const passed = results.filter((r) => r.passed).length;
  const softWarnings = results.flatMap((r) => r.turns.flatMap((t) => t.softWarnings.map((w) => `${r.id}#${t.turnIndex}: ${w}`)));
  console.log("\n=== Conversation Regression Summary ===");
  console.log(`Scenarios: ${passed}/${results.length} hard-pass`);
  console.log(`Soft warnings: ${softWarnings.length}`);
  for (const result of results) {
    const mark = result.passed ? "PASS" : "FAIL";
    console.log(`\n[${mark}] ${result.id} — ${result.description}`);
    for (const turn of result.turns) {
      const rec =
        turn.recommendationCount > 0
          ? ` recs=${turn.recommendationCount}${turn.topVehicle ? ` (${turn.topVehicle})` : ""}`
          : "";
      console.log(
        `  T${turn.turnIndex} type=${turn.type}${turn.promptKey ? ` prompt=${turn.promptKey}` : ""}${rec}`
      );
      console.log(`     user: ${turn.message}`);
      console.log(`     bot:  ${turn.assistantMessage.slice(0, 220)}${turn.assistantMessage.length > 220 ? "…" : ""}`);
      for (const f of turn.hardFailures) console.log(`     HARD: ${f}`);
      for (const w of turn.softWarnings) console.log(`     SOFT: ${w}`);
    }
  }
  if (softWarnings.length) {
    console.log("\nSoft warning list:");
    for (const w of softWarnings) console.log(`  - ${w}`);
  }
}

async function main() {
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath =
    outArg?.slice("--out=".length) ??
    path.join("/opt/cursor/artifacts", "conversation-regression.json");

  // Force seed-data path for stable regression (ignore injected live Supabase).
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.FLOWRYD_DISABLE_EMBEDDINGS ??= "1";
  process.env.FLOWRYD_VEHICLE_STRUCTURED_SEARCH = "0";
  process.env.FLOWRYD_VEHICLE_EMBEDDING_SEARCH = "0";

  console.log(
    `Running ${scenarios.length} conversation scenarios (LLM ${process.env.FLOWRYD_DISABLE_LLM === "1" ? "OFF" : "ON"})…`
  );

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    process.stdout.write(`  · ${scenario.id}… `);
    try {
      const result = await runScenario(scenario);
      results.push(result);
      console.log(result.passed ? "ok" : "FAIL");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        id: scenario.id,
        description: scenario.description,
        passed: false,
        turns: [
          {
            turnIndex: 0,
            message: scenario.turns[0]?.message ?? "",
            type: "chat",
            assistantMessage: "",
            recommendationCount: 0,
            hardPass: false,
            hardFailures: [`scenario threw: ${message}`],
            softWarnings: [],
            criteriaSnapshot: {}
          }
        ]
      });
      console.log(`ERROR: ${message}`);
    }
  }

  printReport(results);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        llmDisabled: process.env.FLOWRYD_DISABLE_LLM === "1",
        llmExplanations: process.env.FLOWRYD_ENABLE_LLM_EXPLANATIONS === "1",
        results
      },
      null,
      2
    )
  );
  console.log(`\nWrote ${outPath}`);

  const failed = results.filter((r) => !r.passed).length;
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
