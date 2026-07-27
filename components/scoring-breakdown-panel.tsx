"use client";

import {
  buildScoringBreakdownRows,
  computeWeightedRuleScore,
  describeScoringWeightAdjustments,
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
  const semanticAdjusted =
    match.ruleScore != null && match.ruleScore !== displayedScore;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Score breakdown
      </div>
      <p className="mb-3 text-xs text-muted-foreground leading-relaxed">
        Match % is a weighted average: each factor score (0–100) is multiplied by its weight, then
        summed. Weights start from defaults and shift based on your priorities below.
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

        <div className="border-t border-border/60 pt-3 text-sm">
          <div className="flex items-center justify-between gap-3 font-semibold tabular-nums">
            <span>Weighted rule score</span>
            <span>{weightedRuleScore}%</span>
          </div>
          {semanticAdjusted ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Displayed match {displayedScore}% includes semantic ranking adjustments (rule score{" "}
              {match.ruleScore}%).
            </p>
          ) : null}
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
