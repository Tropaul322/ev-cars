# Guided, option-based EV matching conversation — Design

Date: 2026-06-23
Status: Approved (ready for implementation plan)

## Problem

The matching chat (`/chat` → `/api/match` → `lib/match-service.ts`) has three user-reported problems:

1. **Repeats the same question.** When the user answers a clarification with their *own* question (e.g. bot asks "What are your charging options?" and the user asks "What charging options are there?"), nothing new is extracted into criteria, readiness is unchanged, and the agent re-emits the identical deterministic question from `clarificationQuestion()`. There is no path for the bot to *answer* the user's question.
2. **Jumps to results prematurely.** `canMatch()` / `getCriteriaReadiness()` flips to `match` as soon as enough criteria accumulate (or any brand/model/origin appears), so the bot can dump listings mid-conversation before the user has finished answering.
3. **Open-ended questions are unclear.** Clarification questions are prose with options buried in the sentence, and the chat UI offers only a free-text box — no clickable choices.

## Goals

- The bot offers **clickable option chips** instead of (only) open-ended text.
- The bot **answers a counter-question** by briefly explaining the options, then re-shows the same chips — no external knowledge lookup.
- The bot **never repeats a question verbatim** and never leaves the user stuck.
- The bot **does not show results** until the user taps a "Show me matches" chip or makes an explicit request. Exception: an opening query that is already match-ready is treated as intent and returns results immediately.

## Non-goals

- No RAG/knowledge-base answering of EV questions in this iteration (counter-questions get a short catalog explanation only).
- No fully LLM-generated option lists (rejected for reliability — see Approach B).

## Chosen approach

**Approach A — deterministic question catalog.** A typed, localized catalog defines one prompt per missing-criteria group; each option carries the exact `CriteriaPatch` it applies. Chip taps apply criteria deterministically through the existing `applyCriteriaPatch()` in `lib/criteria-normalizer.ts`, bypassing the LLM. Optional later enhancement (Approach C): LLM rephrases the lead-in text with the catalog text as fallback.

## Data model

New file `lib/clarification-catalog.ts`:

```ts
type ClarificationOption = {
  id: string;            // e.g. "charging_public"
  label: string;         // localized chip text
  patch: CriteriaPatch;  // applied when selected, e.g. { chargingAccess: "public" }
};

type ClarificationPrompt = {
  key: MissingCriteria | "ready";
  question: string;      // localized lead-in shown in the bot bubble
  explanation: string;   // shown when the user asks a question back
  selectMode: "single" | "multi";
  options: ClarificationOption[];
  showMatchAction: boolean; // include a "Show me matches" chip
};

function getClarificationPrompt(key: MissingCriteria | "ready", language: Language): ClarificationPrompt;
```

Option sets (localized de/en), each ending with a `Skip` option, and a `Show me matches` chip once minimally ready:

- **budget** (single): Under €25k, €25–40k, €40–60k, €60k+, Monthly lease, No limit → `budgetMaxEUR` / `monthlyBudgetEUR`.
- **use_case** (multi): City, Commuting, Family, Road trips, Winter / mountains → `tripNeeds`.
- **charging_or_range** (single): Home / wallbox, At work, Public only, Not sure yet → `chargingAccess`.
- **vehicle_preferences** (multi): SUV, Compact, Sedan, Wagon, Van + New/Used → `bodyTypes` / `preferredCondition`.

## Request / response wiring

- `MatchRequest` (`app/api/match/route.ts`, `lib/match-service.ts`) gains:
  - `criteriaPatch?: CriteriaPatch` — applied deterministically via `applyCriteriaPatch` (no LLM call).
  - `intent?: "show_matches"`.
- `MatchResponse` `chat` and `clarification` variants gain optional `prompt?: ClarificationPrompt`.
- A chip tap sends a human-readable `message` (chosen label[s], so the transcript reads naturally) plus the structured `criteriaPatch`.

## Backend conversation logic (`lib/chat-agent.ts`, `lib/match-service.ts`)

- **No premature matching.** Matching runs only when `intent === "show_matches"`, the message is an explicit search / "next" / "show me cars" request, or it is a direct brand/model lookup. The opening-query exception: if there is no prior session/criteria and the first message is already match-ready, treat it as intent and match. Otherwise return a clarification, or a `ready` prompt (primary chip "Show me matches") when all groups are gathered. The existing auto-match-on-readiness behavior is removed.
- **Answer counter-questions.** If the user's message adds no new criteria *and* looks like a question (ends with `?`, or starts with what/which/how/why · was/welche/wie/warum), reply with the current step's `explanation` and re-show the same chips.
- **Never repeat verbatim.** The match session stores `lastClarificationKey`, a per-key `askCount`, and a set of `skippedKeys`. When the same key would be asked again with no progress, switch to a softer nudge and keep `Skip` / `Show me matches` visible. `Skip` records the key as resolved so it is not asked again.

Session persistence uses the existing `match-session-repository`; new fields (`lastClarificationKey`, `askCounts`, `skippedKeys`) are added to the stored session shape.

## Frontend (`app/chat/page.tsx`)

- Render chips beneath the bot bubble from `prompt`. A new `ChipGroup` component (reusing existing chip styling) manages selection.
- Single-select chips submit immediately. Multi-select chips toggle locally and submit the merged patch via a `Continue` button.
- Free-text input stays fully functional throughout.
- Only the latest prompt is interactive; answered prompts render as static/disabled chips.
- The `prompt` is stored in the chat message payload so reopening a conversation re-renders chips in a non-interactive state. `hydrateStoredChat` is updated accordingly.

## Testing

- Catalog unit tests: every option `patch` is valid and applies cleanly via `applyCriteriaPatch`; all option labels exist for both languages.
- Agent decision tests: counter-question → explanation + re-offer; chip patch → advance to next group; no auto-match without intent; opening-query-ready → match; `Skip` → next group / ready; `Show me matches` → results.
- Slots into existing `tests/matching.test.ts` style.

## Trade-offs / decisions

- Curated options (not LLM-generated) for reliability; adding new option types means editing the catalog.
- Opening-query-ready returns results immediately (fast path for power users); all later clarification turns require an explicit tap to match.
