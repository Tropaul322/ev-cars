# Exact Seat Prioritization Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Rank exact N-seat vehicles above larger ones when the user asks for an N-seater, while still allowing larger cars as lower-scored fallbacks.

**Architecture:** Detect exact-seat phrasing via `hasExactSeatPreference`; adjust `scoreCargoPassengers` only. Keep hard passenger filters as minimums.

**Tech Stack:** TypeScript, node:test

## Task 1: Failing test + scoring fix

**Files:** `tests/matching.test.ts`, `lib/criteria.ts`, `lib/scoring.ts`

- [x] Add test that “sporty 2-seater” ranks 2-seat roadster above 5-seat SUV
- [x] Add `hasExactSeatPreference`
- [x] Update `scoreCargoPassengers`
- [x] Run matching tests for passenger/seat cases
