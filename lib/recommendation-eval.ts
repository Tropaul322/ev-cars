import type { RecommendationReasonLedger, Vehicle } from "./types.ts";

const DEFAULT_EVAL_K = 6;

export function calculateRecallAtK(
  returnedIds: string[],
  expectedEligibleIds: string[],
  k = DEFAULT_EVAL_K
): number {
  if (expectedEligibleIds.length === 0) return 1;
  const topK = new Set(returnedIds.slice(0, k));
  const hits = expectedEligibleIds.filter((id) => topK.has(id)).length;
  return hits / expectedEligibleIds.length;
}

export function calculateNdcgAtK(
  returnedIds: string[],
  relevantIds: string[],
  k = DEFAULT_EVAL_K
): number {
  if (relevantIds.length === 0) return 1;
  const relevant = new Set(relevantIds);
  const topK = returnedIds.slice(0, k);
  const dcg = topK.reduce((sum, id, index) => {
    if (!relevant.has(id)) return sum;
    return sum + 1 / Math.log2(index + 2);
  }, 0);
  const idealDcg = relevantIds.slice(0, k).reduce((sum, _id, index) => {
    return sum + 1 / Math.log2(index + 2);
  }, 0);
  return idealDcg === 0 ? 0 : dcg / idealDcg;
}

function stringifyPermittedValue(value: string | number | boolean): string[] {
  if (typeof value === "boolean") return [String(value)];
  if (typeof value === "number") {
    return [String(value), value.toLocaleString("de-AT").replace(/\./g, "")];
  }
  return [value];
}

function permittedLedgerValues(
  vehicle: Vehicle,
  reasonLedger?: RecommendationReasonLedger
): Set<string> {
  const permitted = new Set<string>();
  const addValue = (value: string | number | boolean) => {
    for (const token of stringifyPermittedValue(value)) {
      permitted.add(token);
    }
  };

  if (reasonLedger) {
    for (const reason of reasonLedger.positiveReasons) {
      addValue(reason.value);
    }
    for (const tradeoff of reasonLedger.tradeoffs) {
      for (const number of extractNumericTokens(tradeoff)) {
        permitted.add(number);
      }
    }
  } else {
    addValue(vehicle.priceEUR);
    addValue(vehicle.rangeKm);
    addValue(vehicle.seats);
    addValue(vehicle.cargoLiters);
    addValue(vehicle.year);
    if (vehicle.monthlyLeaseEUR !== null) addValue(vehicle.monthlyLeaseEUR);
    if (vehicle.batterySoH !== null) addValue(vehicle.batterySoH);
    if (vehicle.mileageKm !== null) addValue(vehicle.mileageKm);
  }

  return permitted;
}

function extractNumericTokens(text: string): string[] {
  return [...text.matchAll(/\d[\d.,]*/g)].map((match) => match[0].replace(/[.,]/g, ""));
}

function extractExplanationFactNumbers(explanation: string, vehicle: Vehicle): string[] {
  let sanitized = explanation;
  const removable = [`${vehicle.make} ${vehicle.model}`, vehicle.model, vehicle.make].sort(
    (left, right) => right.length - left.length
  );
  for (const token of removable) {
    sanitized = sanitized.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  return extractNumericTokens(sanitized);
}

export function explanationIsGrounded(
  explanation: string,
  vehicle: Vehicle,
  reasonLedger?: RecommendationReasonLedger
): boolean {
  const permitted = permittedLedgerValues(vehicle, reasonLedger);
  const explanationNumbers = extractExplanationFactNumbers(explanation, vehicle);
  if (explanationNumbers.some((token) => !permitted.has(token))) {
    return false;
  }

  if (!reasonLedger) return true;

  const selectedReasons = reasonLedger.positiveReasons.slice(0, 3);
  return selectedReasons.every((reason) => {
    const values = stringifyPermittedValue(reason.value);
    return values.some((value) => explanation.includes(value));
  });
}

export function explanationIncludesFacts(
  explanation: string,
  vehicle: Vehicle,
  requiredFacts: Array<keyof Vehicle>
): boolean {
  return requiredFacts.every((field) => {
    const value = vehicle[field];
    if (value === null || value === undefined) return true;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return stringifyPermittedValue(value).some((token) => explanation.includes(token));
    }
    return true;
  });
}

export const evalTopK = DEFAULT_EVAL_K;
