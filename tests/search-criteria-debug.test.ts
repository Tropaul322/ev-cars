import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchCriteriaDebug,
  searchCriteriaDebugEnabled
} from "../lib/search-criteria-debug.ts";
import { emptyCriteria } from "../lib/criteria.ts";

test("searchCriteriaDebugEnabled reads FLOWRYD_SHOW_SEARCH_CRITERIA", () => {
  const previous = process.env.FLOWRYD_SHOW_SEARCH_CRITERIA;
  delete process.env.FLOWRYD_SHOW_SEARCH_CRITERIA;
  assert.equal(searchCriteriaDebugEnabled(), false);

  process.env.FLOWRYD_SHOW_SEARCH_CRITERIA = "1";
  assert.equal(searchCriteriaDebugEnabled(), true);

  if (previous === undefined) delete process.env.FLOWRYD_SHOW_SEARCH_CRITERIA;
  else process.env.FLOWRYD_SHOW_SEARCH_CRITERIA = previous;
});

test("buildSearchCriteriaDebug separates found chips from search filters", () => {
  const previousPipeline = process.env.FLOWRYD_MATCHING_PIPELINE;
  delete process.env.FLOWRYD_MATCHING_PIPELINE;
  delete process.env.FLOWRYD_LIGHT_HARD_MATCHING;

  const criteria = {
    ...emptyCriteria("Tesla Model 3 under 35000", "en"),
    budgetMaxEUR: 35_000,
    bodyTypes: ["sedan" as const],
    brandPreferences: ["Tesla"],
    tripNeeds: ["commute" as const],
    chargingAccess: "home" as const
  };

  const debug = buildSearchCriteriaDebug(criteria, ["vehicle_preferences"]);

  assert.deepEqual(debug.found.map((item) => item.key), [
    "budget",
    "body",
    "use_case",
    "charging",
    "brand"
  ]);
  assert.equal(debug.usedInSearch.budgetMaxEUR, 35_000);
  assert.equal(debug.usedInSearch.matchingPipeline, "classic");
  assert.equal(debug.usedInSearch.retrievePolicy, "full_hard");
  assert.deepEqual(debug.usedInSearch.bodyTypes, undefined);
  assert.deepEqual(debug.usedInSearch.brandPreferences, undefined);
  assert.equal(debug.usedInSearch.preferredCondition, undefined);
  assert.deepEqual(debug.missing, ["vehicle_preferences"]);

  if (previousPipeline === undefined) delete process.env.FLOWRYD_MATCHING_PIPELINE;
  else process.env.FLOWRYD_MATCHING_PIPELINE = previousPipeline;
});

test("buildSearchCriteriaDebug includes hard body and brand filters in search", () => {
  const previousPipeline = process.env.FLOWRYD_MATCHING_PIPELINE;
  delete process.env.FLOWRYD_MATCHING_PIPELINE;
  delete process.env.FLOWRYD_LIGHT_HARD_MATCHING;

  const criteria = {
    ...emptyCriteria("Only Tesla sedan under 35000", "en"),
    budgetMaxEUR: 35_000,
    bodyTypes: ["sedan" as const],
    brandPreferences: ["Tesla"],
    latestUserMessage: "Only Tesla sedan under 35000"
  };

  const debug = buildSearchCriteriaDebug(criteria, []);
  assert.equal(debug.usedInSearch.matchingPipeline, "classic");
  assert.equal(debug.usedInSearch.retrievePolicy, "full_hard");
  assert.deepEqual(debug.usedInSearch.bodyTypes, ["sedan"]);
  assert.deepEqual(debug.usedInSearch.brandPreferences, ["Tesla"]);

  if (previousPipeline === undefined) delete process.env.FLOWRYD_MATCHING_PIPELINE;
  else process.env.FLOWRYD_MATCHING_PIPELINE = previousPipeline;
});
