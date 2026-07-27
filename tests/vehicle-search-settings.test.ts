import assert from "node:assert/strict";
import test from "node:test";
import {
  lightHardMatchingEnabled,
  matchingPipeline,
  softenMatchPreferencesEnabled
} from "../lib/vehicle-search-settings.ts";

function clearMatchingEnv() {
  delete process.env.FLOWRYD_MATCHING_PIPELINE;
  delete process.env.FLOWRYD_LIGHT_HARD_MATCHING;
  delete process.env.FLOWRYD_SOFTEN_MATCH_PREFERENCES;
}

test("matchingPipeline defaults to classic (new matching OFF)", () => {
  clearMatchingEnv();
  assert.equal(matchingPipeline(), "classic");
  assert.equal(lightHardMatchingEnabled(), false);
});

test("FLOWRYD_MATCHING_PIPELINE=light_hard turns new matching ON", () => {
  clearMatchingEnv();
  process.env.FLOWRYD_MATCHING_PIPELINE = "light_hard";
  assert.equal(matchingPipeline(), "light_hard");
  assert.equal(lightHardMatchingEnabled(), true);
});

test("FLOWRYD_MATCHING_PIPELINE=classic turns new matching OFF even if alias is set", () => {
  clearMatchingEnv();
  process.env.FLOWRYD_LIGHT_HARD_MATCHING = "1";
  process.env.FLOWRYD_MATCHING_PIPELINE = "classic";
  assert.equal(matchingPipeline(), "classic");
});

test("FLOWRYD_LIGHT_HARD_MATCHING=1 alias enables light_hard when pipeline unset", () => {
  clearMatchingEnv();
  process.env.FLOWRYD_LIGHT_HARD_MATCHING = "1";
  assert.equal(matchingPipeline(), "light_hard");
});

test("softenMatchPreferencesEnabled is false when pipeline is classic", () => {
  clearMatchingEnv();
  process.env.FLOWRYD_SOFTEN_MATCH_PREFERENCES = "1";
  assert.equal(softenMatchPreferencesEnabled(), false);
});

test("softenMatchPreferencesEnabled requires light_hard master ON", () => {
  clearMatchingEnv();
  process.env.FLOWRYD_MATCHING_PIPELINE = "light_hard";
  process.env.FLOWRYD_SOFTEN_MATCH_PREFERENCES = "1";
  assert.equal(softenMatchPreferencesEnabled(), true);
});
