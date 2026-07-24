import assert from "node:assert/strict";
import test from "node:test";
import { emptyCriteria } from "../lib/criteria.ts";
import type { TripNeed } from "../lib/types.ts";
import {
  bodyTypeLexiconTokens,
  expandVehicleSearchLexicon,
  seatsLexiconTokens
} from "../lib/vehicle-search-lexicon.ts";

test("seatsLexiconTokens includes bilingual 2-seater aliases", () => {
  const tokens = seatsLexiconTokens(2);
  assert.ok(tokens.includes("2 seats"));
  assert.ok(tokens.includes("2-seater"));
  assert.ok(tokens.includes("zweisitzer"));
});

test("bodyTypeLexiconTokens expands suv and coupe-like other", () => {
  assert.ok(bodyTypeLexiconTokens("suv").includes("suv"));
  assert.ok(bodyTypeLexiconTokens("suv").some((t) => /geländewagen|gelaendewagen/i.test(t)));
});

test("expandVehicleSearchLexicon expands sporty + 2-seater message", () => {
  const criteria = {
    ...emptyCriteria("any sporty 2 seater car"),
    optimizationDirective: "performance" as const,
    passengers: 2,
    qualitativeSignals: [],
    tripNeeds: [],
    bodyTypes: []
  };
  const { ftsTokens, embeddingPhrases } = expandVehicleSearchLexicon(
    criteria,
    "any sporty 2 seater car"
  );
  const fts = ftsTokens.join(" ").toLowerCase();
  const emb = embeddingPhrases.join(" ").toLowerCase();
  // Style adjectives stay embedding-only; seat/body aliases stay on FTS.
  assert.ok(!/\bsporty\b|\bsportlich\b|\bperformance\b/.test(fts));
  assert.ok(/2-seater|zweisitzer|2 seats/.test(fts));
  assert.ok(/coupe|cabrio|convertible|roadster/.test(fts));
  assert.ok(/sporty|sportlich/.test(emb));
  assert.ok(ftsTokens.length < 40, "FTS token list should stay short");
});

test("expandVehicleSearchLexicon expands city commute DE/EN", () => {
  const criteria = {
    ...emptyCriteria("Stadtpendeln"),
    tripNeeds: ["city", "commute"] as TripNeed[],
    chargingAccess: "public" as const
  };
  const { ftsTokens, embeddingPhrases } = expandVehicleSearchLexicon(criteria, "small city car Vienna");
  const fts = ftsTokens.join(" ").toLowerCase();
  const emb = embeddingPhrases.join(" ").toLowerCase();
  assert.ok(/compact|kleinwagen/.test(fts));
  assert.ok(!/\bcity\b|\bstadt\b|\bcommute\b|\bpendeln\b/.test(fts));
  assert.ok(/city|stadt|commute|pendel/.test(emb));
});
