# Match Pipeline V2 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close residual v2 quality gaps: stall/timeout invariants, soft preference filters, cue-less pivots, latest-turn hard flags, complete optimization chips, and stronger runner-up justification.

**Architecture:** Extend existing match pipeline helpers (`hasHard*`, `withPipelineFallback`, `hardFilterPolicy`) rather than introducing new services. Soft preferences must reach scoring; retrieve SQL filters must mirror hard policy.

**Tech Stack:** TypeScript, Next.js app router, Vitest/node test runner used by `tests/matching.test.ts`, Supabase vehicle search.

**Spec:** [docs/superpowers/specs/2026-07-23-match-pipeline-v2-hardening-design.md](../specs/2026-07-23-match-pipeline-v2-hardening-design.md)

## Global Constraints

- Never return ready-search copy without matching in the same turn
- Soft preferences must not empty the pool; exclusive language may hard-reject
- Hard-language regex evaluates latest user turn only
- Keep dual alternatives paths (button local + typed cache)
- Do not invent new scoring dimensions for charging/performance this pass

---

## File map

| File | Responsibility |
|---|---|
| `lib/criteria.ts` | New `hasHard*` helpers; latest-turn text for hard checks |
| `lib/scoring.ts` | `hardFilterPolicy`, `getHardFilterReasons`, soft body/condition scores |
| `lib/repositories/vehicle-repository.ts` | Retrieve filters only when hard |
| `lib/criteria-normalizer.ts` | Topic-conflict pivots |
| `lib/match-service.ts` | Deadline, ready→match, score fallback, first-turn gate, justification |
| `lib/clarification-catalog.ts` | All 7 optimization chips |
| `lib/explanations.ts` | Singular recommendation tone |
| `components/chat-page.tsx` | AbortController ~15s |
| `tests/matching.test.ts` | Coverage for all behaviors |

---

### Task 1: Hard/soft helpers + scoring + retrieve

- [ ] Add failing tests for soft body/condition/brand and exclusive hard cases
- [ ] Add `hasHardBodyTypeConstraint`, `hasHardConditionConstraint`, `hasHardBrandConstraint`, `hasHardBrandOriginConstraint` in `lib/criteria.ts` using latest-turn text
- [ ] Update `hasHardPassengerConstraint` / `hasHardRangeConstraint` to use latest-turn text
- [ ] Update `getHardFilterReasons` + `hardFilterPolicy`
- [ ] Soft-score body in `scoreCargoPassengers`, condition in `scoreReliability`
- [ ] Align `vehicle-repository` SQL/local filters with `hasHard*`
- [ ] Run tests; commit

### Task 2: Stall / timeout / ready / first-turn

- [ ] Add failing tests for ready→match, non-empty score fallback, first-turn chip gate
- [ ] Shared deadline from start of `runMatchRequest`; wrap pre-pipeline LLM
- [ ] Force `wantsMatch` when prompt would be `ready`
- [ ] `filter_score` fallback = `matchVehicles` on retrieved list
- [ ] First-turn gate ignores `criteriaPatch` bypass
- [ ] Client `AbortController` ~15s
- [ ] Run tests; commit

### Task 3: Pivot, optimization chips, justification

- [ ] Add failing tests for cue-less topic conflict pivot and hard-flag bleed
- [ ] Extend `isTopicPivot` with topic-conflict detection
- [ ] Add missing optimization chips
- [ ] Improve `addPrimaryRecommendationJustification` with concrete facts
- [ ] Fix plural “ranked listings” tone in explanations
- [ ] Run full matching tests; commit
