import assert from "node:assert/strict";
import test from "node:test";
import { clarificationReplyMisalignedWithPrompt } from "../lib/clarification-copy-alignment.ts";

test("personal_wish step misaligned when LLM asks about charging", () => {
  const chargingQuestion =
    "Thanks! Aiming for 350+ km is great. Do you prefer to charge at home, work, or public stations?";
  assert.equal(clarificationReplyMisalignedWithPrompt(chargingQuestion, "personal_wish"), true);
});

test("personal_wish step aligned when asking about emotional driver", () => {
  const wishQuestion =
    "What should shape the recommendation — status or freedom?";
  assert.equal(clarificationReplyMisalignedWithPrompt(wishQuestion, "personal_wish"), false);
});

test("charging_or_range step misaligned when only charging location is asked", () => {
  const chargingOnly = "Would you charge at home, at work, or mostly at public stations?";
  assert.equal(clarificationReplyMisalignedWithPrompt(chargingOnly, "charging_or_range"), true);
});

test("charging_or_range step aligned when asking minimum range", () => {
  const rangeQuestion = "What minimum range do you need on a typical day — 250, 350, or more km?";
  assert.equal(clarificationReplyMisalignedWithPrompt(rangeQuestion, "charging_or_range"), false);
});
