"use client";

import {
  buildScoringBreakdownRows,
  computeWeightedRuleScore,
  describeScoringWeightAdjustments,
  formatMatchScoreEquation,
  formatWeightDelta,
} from "@/lib/scoring-breakdown-display";
import type { MatchResult, UserCriteria } from "@/lib/types";

export function ScoringBreakdownPanel({
  match,
  criteria,
}: {
  match: MatchResult;
  criteria?: UserCriteria | null;
}) {
  const rows = buildScoringBreakdownRows(match);
  const weightedRuleScore = computeWeightedRuleScore(
    match.scoringBreakdown,
    match.scoringWeights
  );
  const weightNotes = describeScoringWeightAdjustments(criteria);
  const displayedScore = match.score;
  // Always explain against the factor average — even if ruleScore was missing on older payloads.
  const ruleScore = weightedRuleScore;
  const scoreAdjusted = displayedScore !== ruleScore;
  const adjustmentDelta = displayedScore - ruleScore;
  const semanticBoost = match.semanticBoost;
  const semanticComponents = semanticBoost?.components ?? [];
  const isLlmAdjusted = match.scoreSource === "llm" && scoreAdjusted;
  const factorPtsSum = rows.reduce((sum, row) => sum + row.contribution, 0);
  const equation = formatMatchScoreEquation(ruleScore, displayedScore, semanticBoost);

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Score breakdown
      </div>
      <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
        Two numbers matter: the <span className="text-foreground font-medium">rule score</span>{" "}
        (specs × your priorities) and the <span className="text-foreground font-medium">total score</span>
        {scoreAdjusted
          ? `, which adds wording-relevance points on top: ${equation}.`
          : `, which equals the rule score here.`}
      </p>

      <div className="rounded-2xl bg-muted/50 p-3 space-y-3">
        <div className="grid grid-cols-[minmax(0,1.2fr)_auto] gap-x-3 gap-y-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b border-border/60 pb-2">
          <span>Factor</span>
          <span className="text-right">Score × weight → pts</span>
        </div>

        {rows.map((row) => (
          <div key={row.key} className="space-y-1">
            <div className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-foreground">{row.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Weight {row.weightPct}% ({formatWeightDelta(row.weightDeltaPct)}, default{" "}
                  {row.baseWeightPct}%)
                </div>
              </div>
              <div className="text-right tabular-nums shrink-0">
                <div className="font-semibold">
                  {row.factorScore}% × {row.weightPct}%
                </div>
                <div className="text-xs text-muted-foreground">≈ {row.contribution} pts</div>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${row.factorScore}%` }}
              />
            </div>
          </div>
        ))}

        <div className="border-t border-border/60 pt-3 text-sm space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3 tabular-nums">
              <span className="text-muted-foreground">1. Weighted rule score</span>
              <span className="font-semibold">{ruleScore}%</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Sum of the factor points above (≈ {factorPtsSum} pts, rounded to {ruleScore}%). This is
              only specs vs your criteria — price, range, efficiency, brand, cargo, reliability,
              features.
            </p>
          </div>

          {scoreAdjusted ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 tabular-nums">
                  <span className="text-muted-foreground">
                    2. {isLlmAdjusted ? "LLM fit adjustment" : "Wording relevance boost"}
                  </span>
                  <span className="font-semibold">
                    {adjustmentDelta > 0 ? "+" : ""}
                    {adjustmentDelta}
                  </span>
                </div>

                {isLlmAdjusted ? (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {match.llmFitSummary ??
                      "An LLM fit pass re-scored this car against your intent, so the total score can differ from the rule average."}
                  </p>
                ) : semanticBoost ? (
                  <div className="rounded-xl bg-background/70 border border-border/50 p-2.5 space-y-2.5">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Extra points for how well this listing matches your wording (not in the 7
                      factors):
                    </p>
                    <p className="text-xs font-medium text-foreground tabular-nums leading-relaxed">
                      round({Math.round(semanticBoost.blendStrength * 100)}% wording fit ×{" "}
                      {semanticBoost.boostScale} max pts) = +{semanticBoost.totalPoints}
                    </p>
                    {semanticComponents.length > 0 ? (
                      <div className="space-y-2 pt-1 border-t border-border/40">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          That wording fit breaks down as
                        </div>
                        {semanticComponents.map((component) => (
                          <div key={component.key} className="space-y-0.5">
                            <div className="flex items-start justify-between gap-3 text-xs">
                              <span className="font-medium text-foreground">
                                {component.label}{" "}
                                <span className="text-muted-foreground font-normal">
                                  ({Math.round(component.signal * 100)}%)
                                </span>
                              </span>
                              <span className="tabular-nums shrink-0 text-muted-foreground">
                                +{component.points}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              {component.detail}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    +{adjustmentDelta} from wording/search relevance on top of the rule score.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-3 font-semibold tabular-nums">
                  <span>3. Total score</span>
                  <span>{displayedScore}%</span>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums leading-relaxed">
                  {ruleScore} + {adjustmentDelta} = {displayedScore}%
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-2.5 space-y-1">
              <div className="flex items-center justify-between gap-3 font-semibold tabular-nums">
                <span>Total score</span>
                <span>{displayedScore}%</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Same as the weighted rule score — no wording boost applied.
              </p>
            </div>
          )}
        </div>
      </div>

      {weightNotes.length > 0 ? (
        <div className="mt-3 rounded-2xl border border-border/60 bg-background/60 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Weight shifts for this search
          </div>
          <ul className="space-y-1.5 text-xs text-muted-foreground list-disc pl-4">
            {weightNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
