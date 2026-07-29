import type { ClarificationPromptKey, MissingCriteria } from "./types.ts";

/** Detect when LLM copy drifts from the catalog step shown as quick-reply chips. */
export function clarificationReplyMisalignedWithPrompt(
  message: string,
  promptKey: ClarificationPromptKey | MissingCriteria
): boolean {
  const text = message.toLowerCase();

  const mentionsChargingLocation =
    /\b(charg(e|ing|e\s+the\s+car)|wallbox|ladestation|laden\s+(zu)?hause|public\s+charg|at\s+home|at\s+work)\b/i.test(
      message
    ) || /\b(home|work)\b.*\b(charg|lad)/i.test(message);

  const mentionsRangeKm =
    /\b(range|reichweite|kilometer|kilomet|km\b|\d+\s*\+?\s*km|daily\s+distance|farthest\s+trip)\b/i.test(
      text
    );

  const mentionsPersonalWish =
    /\b(status|freedom|personal\s+wish|feels?\s+right|emotional)\b/i.test(
      text
    );

  switch (promptKey) {
    case "personal_wish":
      return mentionsChargingLocation && !mentionsPersonalWish;
    case "charging_or_range":
      return mentionsChargingLocation && !mentionsRangeKm;
    case "budget":
      return mentionsChargingLocation || (/\b(body|suv|sedan|compact)\b/i.test(text) && !/\b(budget|price|€|euro)\b/i.test(text));
    case "vehicle_preferences":
      return mentionsChargingLocation && !/\b(suv|sedan|compact|wagon|van|body|karosserie)\b/i.test(text);
    case "use_case":
      return mentionsChargingLocation && !/\b(city|commute|family|road\s+trip|winter|pendel)\b/i.test(text);
    case "preferred_color":
      return (
        mentionsChargingLocation &&
        !/\b(color|colour|farbe|black|white|blue|grey|gray|silver|red)\b/i.test(text)
      );
    default:
      return false;
  }
}
