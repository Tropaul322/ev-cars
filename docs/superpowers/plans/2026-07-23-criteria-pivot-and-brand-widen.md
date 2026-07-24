# Criteria Pivot Reset and Brand-Widen Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect profile pivots vs refinements so sticky brands clear on genuine pivots, and route “other brands” asks to rematch with inventory-grounded replies — LLM primary, deterministic fallback.

**Architecture:** Extend `isTopicPivot` / merge-base clearing in `criteria-normalizer.ts`, add `looksLikeBrandWidenRequest` in `criteria.ts`, teach intent + normalizer prompts the same rules, and ground match intros with distinct makes from results. Deterministic path must succeed with `FLOWRYD_DISABLE_LLM=1`.

**Tech Stack:** TypeScript, Next.js app router, Node test runner (`npm test` → `node --experimental-strip-types --test tests/*.test.ts`).

**Spec:** [docs/superpowers/specs/2026-07-23-criteria-pivot-and-brand-widen-design.md](../specs/2026-07-23-criteria-pivot-and-brand-widen-design.md)

## Global Constraints

- Do **not** `git commit` (or push) unless the user explicitly asks in that turn
- Preserve budget + charging on profile pivot (`buildPivotBase`)
- Mild refinements (budget/features/charging) must keep brand focus
- Brand-widen clears **only** `brandPreferences` + `modelPreferences` (not full topic wipe)
- Brand-suggestion copy must not invent makes absent from match results
- EN + DE patterns; no new DB/RPC; no new ConversationTrigger type (use `update_criteria` + `remove`)

---

## File map

| File | Responsibility |
| --- | --- |
| `lib/criteria.ts` | `looksLikeBrandWidenRequest`; export small helpers if needed for restating brands |
| `lib/criteria-normalizer.ts` | Brand-profile pivot in `hasTopicConflict` / `isTopicPivot`; brand-widen merge base; post-patch safety; normalizer system prompt |
| `lib/conversational-intent.ts` | Pattern + LLM prompt: brand-widen → `update_criteria` with `remove: ["brand","model"]`, not bare `ev_question` |
| `lib/assistant-messages.ts` | Match intro task + fallback that can list inventory brands |
| `lib/explanations.ts` / `lib/match-service.ts` | Pass `inventoryBrands` (and optional `brandWiden`) into intro generation |
| `tests/matching.test.ts` | Pivot + normalize + grounded intro tests |
| `tests/conversational-intent.test.ts` | Brand-widen pattern / routing tests |

---

### Task 1: Brand-widen detection + intent routing

**Files:**
- Modify: `lib/criteria.ts` (near `looksLikeBrandFocusQuestion`)
- Modify: `lib/conversational-intent.ts` (`triggerClassifierPrompt`, `detectPatternTriggers`, `classifyConversationTurn`, `buildPatternCriteriaPatch`, `pickPrimaryPatternTrigger` if needed)
- Test: `tests/conversational-intent.test.ts`

**Interfaces:**
- Produces: `looksLikeBrandWidenRequest(text: string): boolean`
- Produces: pattern resolution with `trigger: "update_criteria"` and `criteriaPatch: { remove: ["brand", "model"] }` when brand-widen matches
- Consumes: existing `buildPatternCriteriaPatch`, `detectPatternTriggers`

- [ ] **Step 1: Write the failing tests**

Add to `tests/conversational-intent.test.ts`:

```ts
import { looksLikeBrandWidenRequest } from "../lib/criteria.ts";

test("detects brand-widen requests in EN and DE", () => {
  assert.equal(looksLikeBrandWidenRequest("What other car brands you can suggest?"), true);
  assert.equal(looksLikeBrandWidenRequest("What other brands can you suggest?"), true);
  assert.equal(looksLikeBrandWidenRequest("any brand is fine"), true);
  assert.equal(looksLikeBrandWidenRequest("welche Marken kannst du vorschlagen?"), true);
  assert.equal(looksLikeBrandWidenRequest("andere Marken bitte"), true);
  assert.equal(looksLikeBrandWidenRequest("egal welche Marke"), true);
  assert.equal(looksLikeBrandWidenRequest("What about Ford?"), false);
  assert.equal(looksLikeBrandWidenRequest("show me sporty 2-seaters"), false);
});

test("brand-widen patterns prefer update_criteria over ev_question", () => {
  const triggers = detectPatternTriggers("What other car brands can you suggest?");
  assert.ok(triggers.includes("update_criteria"));
  assert.equal(triggers.includes("ev_question"), false);
  assert.equal(classifyConversationTurn("What other car brands can you suggest?"), "criteria");
});

test("pattern-only resolution clears brand on brand-widen", () => {
  const resolved = resolveConversationTurnPatternOnly({
    message: "What other car brands can you suggest?"
  });
  assert.equal(resolved.trigger, "update_criteria");
  assert.deepEqual(resolved.criteriaPatch?.remove?.slice().sort(), ["brand", "model"]);
});
```

Import `resolveConversationTurnPatternOnly` from `../lib/conversational-intent.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="brand-widen"`

Expected: FAIL — `looksLikeBrandWidenRequest` is not exported / undefined.

- [ ] **Step 3: Implement `looksLikeBrandWidenRequest`**

In `lib/criteria.ts` after `looksLikeBrandFocusQuestion`:

```ts
export function looksLikeBrandWidenRequest(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    /\b((what|which)\s+other\s+(car\s+)?brands?\b|\bother\s+(car\s+)?brands?\b|\bany\s+brand\b|\bany\s+make\b|\bbrand\s+doesn'?t\s+matter\b|\bno\s+brand\s+preference\b)/i.test(
      trimmed
    ) ||
    /\b(andere\s+marken|welche\s+marken|egal\s+welche\s+marke|marke\s+egal|egal\s+welche\s+marke)\b/i.test(
      trimmed
    )
  );
}
```

(Adjust regex carefully so “What about Ford?” stays false.)

- [ ] **Step 4: Wire intent patterns and LLM prompt**

In `lib/conversational-intent.ts`:

1. Import `looksLikeBrandWidenRequest` from `./criteria.ts`.
2. In `detectPatternTriggers`, **before** `looksLikeEvQuestion`:

```ts
  if (looksLikeBrandWidenRequest(text)) {
    triggers.push("update_criteria");
  } else if (looksLikeEvQuestion(text)) {
    triggers.push("ev_question");
  }
```

(Replace the existing unconditional `looksLikeEvQuestion` push.)

3. In `classifyConversationTurn`, before `looksLikeEvQuestion`:

```ts
  if (looksLikeBrandWidenRequest(text)) return "criteria";
```

4. Extend `buildPatternCriteriaPatch`:

```ts
function buildPatternCriteriaPatch(message: string, trigger: ConversationTrigger): CriteriaPatch | undefined {
  if (looksLikeBrandWidenRequest(message)) {
    return { remove: ["brand", "model"] };
  }
  if (trigger !== "brand_focus") return undefined;
  // ... existing brand_focus logic
}
```

5. Update `triggerClassifierPrompt` Rules section with:

```
8. "What other brands…?", "any brand", "andere Marken", "welche Marken" → update_criteria with criteriaPatch.remove including "brand" and "model". Never route these to ev_question when the user is shopping for listings.
9. Profile pivots (family SUV → sporty 2-seater, brand-only → new seats/body/sport profile without restating the brand) → update_criteria; omit old brands or remove brand/model.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="brand-widen|What about Ford|detectPatternTriggers"`

Expected: PASS for new brand-widen tests; existing Ford `brand_focus` tests still PASS.

- [ ] **Step 6: Pause for commit**

Do not commit. Tell the user Task 1 is done and wait for explicit commit approval (or continue).

---

### Task 2: Profile pivot — brand-only prior + vehicle profile

**Files:**
- Modify: `lib/criteria-normalizer.ts` (`hasTopicConflict`, normalizer `criteriaNormalizerSystemPrompt` / rules block, optionally export helpers)
- Test: `tests/matching.test.ts`

**Interfaces:**
- Consumes: `extractCriteria`, existing `isTopicPivot` / `buildPivotBase`
- Produces: `isTopicPivot("any sporty 2-seater", fordOnlyPrior) === true` and normalize clears brands while keeping budget

- [ ] **Step 1: Write the failing tests**

Add to `tests/matching.test.ts`:

```ts
test("brand-only prior pivots to sporty 2-seater and clears brand", async () => {
  const previous = extractCriteria("Ford cars under 40000 EUR");
  assert.ok(previous.brandPreferences.some((b) => /ford/i.test(b)));
  assert.equal(isTopicPivot("any sporty 2 seater car", previous), true);

  const normalized = await normalizeCriteria({
    message: "any sporty 2 seater car",
    previousCriteria: previous
  });

  assert.equal(normalized.criteria.budgetMaxEUR, 40000);
  assert.deepEqual(normalized.criteria.brandPreferences, []);
  assert.deepEqual(normalized.criteria.modelPreferences, []);
  assert.equal(normalized.criteria.passengers, 2);
});

test("brand focus survives mild budget refinement", async () => {
  const previous = extractCriteria("Family SUV Ford under 60000 EUR with big cargo");
  assert.equal(isTopicPivot("make it under 45k", previous), false);

  const normalized = await normalizeCriteria({
    message: "make it under 45k",
    previousCriteria: previous
  });

  assert.equal(normalized.criteria.budgetMaxEUR, 45000);
  assert.ok(normalized.criteria.brandPreferences.some((b) => /ford/i.test(b)));
});

test("restating the brand during a profile ask keeps that brand", async () => {
  const previous = extractCriteria("Ford cars under 40000 EUR");
  assert.equal(isTopicPivot("sporty Ford 2-seater", previous), false);

  const normalized = await normalizeCriteria({
    message: "sporty Ford 2-seater",
    previousCriteria: previous
  });

  assert.ok(normalized.criteria.brandPreferences.some((b) => /ford/i.test(b)));
  assert.equal(normalized.criteria.passengers, 2);
});
```

Note: If `isTopicPivot("sporty Ford 2-seater", previous)` is true due to cue-less sport signals **and** brand restated, pivot base clears brands then patch/extract must re-add Ford. Prefer implementing restatement so either `isTopicPivot` is false **or** post-apply keeps restated brands. Assert the **outcome** (Ford present, passengers 2) as the source of truth; adjust the `isTopicPivot` assert if implementation clears-then-reapplies.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="brand-only prior|brand focus survives|restating the brand"`

Expected: FAIL — `isTopicPivot("any sporty 2 seater car", fordOnly)` is `false`.

- [ ] **Step 3: Extend topic-conflict detection**

In `lib/criteria-normalizer.ts`, inside `hasTopicConflict`, after existing family/sport/body checks:

```ts
  if (isBrandOnlyProfilePivot(previousCriteria, extracted, message)) return true;

  return false;
}

function introducesVehicleProfile(extracted: UserCriteria, message: string) {
  return Boolean(
    extracted.passengers ||
      extracted.bodyTypes.length ||
      extracted.tripNeeds.length ||
      extracted.optimizationDirective === "performance" ||
      /(?:\b(?:2|two)[-\s]?(?:seater|sitzer)\b|\bsports?\b|\bcoupe\b|\broadster\b|\bsportlich\b|\bperformance\b|\bfamily\b|\bfamilie\b|\bsuv\b)/i.test(
        message
      )
  );
}

function messageRestatesPriorBrands(message: string, previousCriteria: UserCriteria) {
  return previousCriteria.brandPreferences.some((brand) =>
    new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(message)
  );
}

/** Brand-only (or brand without prior seats/body/trip/performance) → new vehicle profile without restating brand. */
function isBrandOnlyProfilePivot(
  previousCriteria: UserCriteria,
  extracted: UserCriteria,
  message: string
) {
  if (!previousCriteria.brandPreferences.length) return false;
  if (messageRestatesPriorBrands(message, previousCriteria)) return false;
  if (!introducesVehicleProfile(extracted, message)) return false;

  const priorHadProfile = Boolean(
    previousCriteria.passengers ||
      previousCriteria.bodyTypes.length ||
      previousCriteria.tripNeeds.length ||
      previousCriteria.optimizationDirective === "performance"
  );
  return !priorHadProfile;
}
```

Reuse project `escapeRegExp` if already importable from `criteria.ts`; otherwise keep local escape as above.

- [ ] **Step 4: Teach the normalizer system prompt**

Extend the Core rules in the criteria normalizer prompt (same file) with:

```
8. Brand-only previousCriteria + new seats/body/sport/family profile without naming that brand → treat as pivot: do not keep brandPreferences/modelPreferences; server also resets topic filters.
9. Mild refinements (budget, features, charging only) keep prior brandPreferences.
10. "other brands" / "any brand" / "andere Marken" → criteriaPatch.remove: ["brand","model"] (and empty brand/model lists).
```

- [ ] **Step 5: Post-patch safety net in `normalizeCriteria`**

After applying the LLM (or fallback) patch, if the original `previousCriteria` existed and (`isTopicPivot(message, previousCriteria)` or `looksLikeBrandWidenRequest(message)`), ensure brands/models are cleared unless restated:

```ts
  let criteria = applyCriteriaPatch(...);
  criteria = enforcePivotBrandClears(message, previousCriteria, criteria);
  return await buildNormalization(...);
```

```ts
function enforcePivotBrandClears(
  message: string,
  previousCriteria: UserCriteria | null | undefined,
  criteria: UserCriteria
): UserCriteria {
  if (!previousCriteria) return criteria;
  const widen = looksLikeBrandWidenRequest(message);
  const pivoted = isTopicPivot(message, previousCriteria);
  if (!widen && !pivoted) return criteria;
  if (!widen && messageRestatesPriorBrands(message, previousCriteria)) return criteria;
  if (!criteria.brandPreferences.length && !criteria.modelPreferences.length) return criteria;
  return normalizeCriteriaShape({
    ...criteria,
    brandPreferences: widen || !messageRestatesPriorBrands(message, previousCriteria)
      ? []
      : criteria.brandPreferences,
    modelPreferences: widen || !messageRestatesPriorBrands(message, previousCriteria)
      ? []
      : criteria.modelPreferences
  });
}
```

Also treat brand-widen in mergeBase **before** extract (targeted clear, not full `buildPivotBase`):

```ts
  const widen = looksLikeBrandWidenRequest(message);
  const mergeBase =
    previousCriteria && isTopicPivot(message, previousCriteria)
      ? buildPivotBase(previousCriteria)
      : previousCriteria && widen
        ? normalizeCriteriaShape({
            ...normalizeCriteriaShape(previousCriteria),
            brandPreferences: [],
            modelPreferences: []
          })
        : previousCriteria;
```

Import `looksLikeBrandWidenRequest` from `./criteria.ts`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --test-name-pattern="brand-only prior|brand focus survives|restating the brand|topic pivots|topic conflict pivots|non-pivot refinements"`

Expected: all PASS.

- [ ] **Step 7: Pause for commit**

Do not commit unless the user asks.

---

### Task 3: Rematch path + inventory-grounded brand reply

**Files:**
- Modify: `lib/assistant-messages.ts` (`generateMatchIntroMessage`, `fallbackMatchIntroMessage`)
- Modify: `lib/explanations.ts` (`selectAndExplainMatches` options / call site)
- Modify: `lib/match-service.ts` (detect brand-widen turn; pass inventory brands into selection/intro)
- Test: `tests/matching.test.ts`

**Interfaces:**
- Produces: `fallbackMatchIntroMessage(criteria, count, lowConfidenceQuestion?, inventoryBrands?: string[])`
- Produces: match-route behavior — Ford-locked session + brand-widen message → empty `brandPreferences` and assistant text that only names makes from recommendations when matches exist

- [ ] **Step 1: Write the failing tests**

```ts
test("brand-widen clears brands and grounds intro in match makes", async () => {
  const previous = extractCriteria(
    "Ford sporty 2-seater under 40000 EUR, public charging, best value."
  );
  assert.ok(previous.brandPreferences.length);

  const data = await runMatchRequest({
    message: "What other car brands can you suggest?",
    previousCriteria: previous,
    intent: "show_matches"
  });

  assert.deepEqual(data.criteria.brandPreferences, []);
  assert.ok(data.type === "matches" || data.type === "no_matches");

  if (data.type === "matches") {
    const makes = [...new Set(data.recommendations.map((r) => r.vehicle.make))];
    for (const make of makes) {
      // Intro may list a subset; it must not claim a make that is not in results.
      // Stronger check: every brand name mentioned after "brand" heuristics is hard;
      // instead assert Ford is not required and at least one non-empty recommendation make
      // appears in assistantMessage when there are recommendations.
    }
    assert.equal(data.criteria.brandPreferences.includes("Ford"), false);
    if (makes.length) {
      assert.ok(
        makes.some((make) => data.assistantMessage.toLowerCase().includes(make.toLowerCase())),
        `expected intro to mention one of ${makes.join(", ")}`
      );
    }
  }
});

test("fallbackMatchIntroMessage lists inventory brands when provided", () => {
  const criteria = emptyCriteria("x", "en");
  const msg = fallbackMatchIntroMessage(criteria, 3, null, ["Mazda", "BMW"]);
  assert.match(msg, /Mazda/);
  assert.match(msg, /BMW/);
  assert.doesNotMatch(msg, /Toyota/);
});
```

Import `fallbackMatchIntroMessage` and `emptyCriteria` as needed. If `runMatchRequest` with `FLOWRYD_DISABLE_LLM=1` does not yet pass inventory brands into the fallback intro, the first test’s “mentions make” assert is the failing driver for Task 3 wiring.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern="brand-widen clears|fallbackMatchIntroMessage lists"`

Expected: FAIL on signature / missing brand list in intro.

- [ ] **Step 3: Extend fallback + LLM match intro**

In `lib/assistant-messages.ts`:

```ts
export async function generateMatchIntroMessage(input: {
  criteria: UserCriteria;
  recommendationCount: number;
  lowConfidenceQuestion?: string | null;
  rejectedSummary?: RejectedSummary[];
  inventoryBrands?: string[];
  brandWiden?: boolean;
}): Promise<string> {
  const brands = [...new Set((input.inventoryBrands ?? []).filter(Boolean))];
  const fallback = () =>
    fallbackMatchIntroMessage(
      input.criteria,
      input.recommendationCount,
      input.lowConfidenceQuestion,
      input.brandWiden ? brands : undefined
    );

  const brandRule = input.brandWiden
    ? brands.length
      ? ` The user asked for other brands. Mention only these inventory brands present in the current results: ${brands.join(", ")}. Do not invent other brands.`
      : ` The user asked for other brands but the current result set is empty of brand diversity — do not invent brands.`
    : "";

  const generated = await generateMessage("match_intro", {
    task:
      "Briefly introduce the ranked EV listings. Mention that hard limits like budget, availability, and explicit range were respected. Add the lowConfidenceQuestion when provided." +
      brandRule,
    language: input.criteria.language,
    recommendationCount: input.recommendationCount,
    lowConfidenceQuestion: input.lowConfidenceQuestion ?? null,
    rejectedSummary: input.rejectedSummary ?? [],
    criteria: input.criteria,
    inventoryBrands: brands,
    brandWiden: Boolean(input.brandWiden)
  });

  return generated ?? fallback();
}

export function fallbackMatchIntroMessage(
  criteria: UserCriteria,
  recommendationCount: number,
  lowConfidenceQuestion?: string | null,
  inventoryBrands?: string[]
) {
  const brands = [...new Set((inventoryBrands ?? []).filter(Boolean))];
  const brandSentence =
    brands.length === 0
      ? ""
      : criteria.language === "de"
        ? ` Andere Marken in diesen Treffern: ${brands.join(", ")}.`
        : ` Other brands in these results: ${brands.join(", ")}.`;
  const base =
    criteria.language === "de"
      ? `${recommendationCount} passende E-Auto${recommendationCount === 1 ? "" : "s"} gefunden. Ich habe harte Grenzen wie Budget, Verfuegbarkeit und explizite Reichweite zuerst eingehalten.${brandSentence}`
      : `Found ${recommendationCount} matching EV${recommendationCount === 1 ? "" : "s"}. I kept hard limits like budget, availability, and explicit range first.${brandSentence}`;
  return lowConfidenceQuestion ? `${base} ${lowConfidenceQuestion}` : base;
}
```

Update every existing `fallbackMatchIntroMessage(...)` call site to remain compatible (new 4th arg optional).

- [ ] **Step 4: Pass brands from explanations + match-service**

In `lib/explanations.ts`, extend `selectAndExplainMatches` options:

```ts
  options: {
    maxRecommendations?: number;
    lowConfidenceQuestion?: string | null;
    rejectedSummary?: RejectedSummary[];
    brandWiden?: boolean;
  } = {}
```

When calling `generateMatchIntroMessage`, pass:

```ts
  inventoryBrands: recommendations.map((m) => m.vehicle.make),
  brandWiden: Boolean(options.brandWiden)
```

In `lib/match-service.ts`:

```ts
import { looksLikeBrandWidenRequest } from "./criteria.ts";
// ...
const brandWiden = looksLikeBrandWidenRequest(body.message);
```

Ensure brand-widen cannot stay on the chat path: if `trigger === "ev_question" && brandWiden`, treat as criteria shopping (e.g. force `criteriaChanged` path / do not set `isChatTurn`). Concrete change near `isChatTurn`:

```ts
  const isChatTurn =
    !body.criteriaPatch &&
    !looksLikeBrandWidenRequest(body.message) &&
    (trigger === "small_talk" ||
      trigger === "meta" ||
      (trigger === "ev_question" && !criteriaChanged));
```

When calling `selectAndExplainMatches` / `fallbackSelection` intro path, pass `brandWiden`.

Also pass `brandWiden` into the `fallbackSelection` helper if it builds intros.

- [ ] **Step 5: Run unit tests**

Run: `npm test -- --test-name-pattern="brand-widen|brand-only prior|brand focus survives|restating the brand|topic pivots|topic conflict"`

Expected: PASS. If match-route test needs Supabase, it may be `test.skip` when inventory missing — ensure unit asserts on `fallbackMatchIntroMessage` always run.

- [ ] **Step 6: Pause for commit**

Do not commit unless the user asks.

---

### Task 4: Full regression + manual browser check

**Files:** none new; verify only.

- [ ] **Step 1: Run full related suites**

Run:

```bash
npm test -- --test-name-pattern="brand|pivot|topic|Ford|intent|match route"
```

Then:

```bash
npm test
```

Expected: all previously passing tests still PASS; new tests PASS.

- [ ] **Step 2: Start dev server and reproduce the user flow**

```bash
npm run dev
```

In the browser chat (or API):

1. “Ford cars under 40000”
2. Complete clarifications if prompted until matches
3. “any sporty 2 seater car” → confirm logs/criteria show **no** Ford preference; results not brand-locked to Ford
4. “What other car brands can you suggest?” → rematch; assistant names only makes from results; no generic Mazda/Toyota/BMW encyclopedia unless those makes are in the result set

Watch server logs for criteria dumps / LLM JSON: `brandPreferences` should be `[]` after steps 3–4; match_intro / assistant content must not invent brands.

- [ ] **Step 3: Fix any anomalies found**

If the LLM still returns encyclopedia text with `FLOWRYD_DISABLE_LLM` off, tighten match_intro / conversational prompts and keep the deterministic fallback sentence with `inventoryBrands`. Re-run the failing scenario.

- [ ] **Step 4: Pause for commit**

Summarize findings for the user. Commit only if they explicitly ask.

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Profile pivot clears topic filters via `buildPivotBase` | Task 2 |
| Brand-only → sporty 2-seater clears brands | Task 2 |
| Mild refinement keeps brands | Task 2 |
| Brand restated keeps brand | Task 2 |
| LLM prompts teach pivots / brand-widen | Tasks 1–2 |
| Deterministic fallback | Tasks 1–2 |
| Brand-widen → clear brand/model + rematch | Tasks 1, 3 |
| Ground reply in match makes | Task 3 |
| Not bare `ev_question` encyclopedia | Tasks 1, 3 |
| EN/DE patterns | Task 1 |
| Manual browser verification | Task 4 |

## Placeholder / consistency self-review

- No TBD/TODO placeholders left in steps.
- `looksLikeBrandWidenRequest` name used consistently across tasks.
- Brand-widen uses `update_criteria` + `remove: ["brand","model"]` (no new trigger).
- Commits gated on explicit user approval in every task.
