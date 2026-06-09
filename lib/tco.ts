import type { TcoBreakdown, UserCriteria, Vehicle } from "./types.ts";

export const TCO_ASSUMPTIONS_VERSION = "AT-EV-alpha-2026-06";
export const AUSTRIA_VAT_RATE = 0.2;
export const DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH = 0.28;

export function calculateTco(vehicle: Vehicle, criteria: UserCriteria): TcoBreakdown {
  const annualKmAssumption = estimateAnnualKm(criteria);
  const incentive = getConfiguredIncentive(vehicle);
  const monthlyEnergy =
    ((annualKmAssumption / 12) * vehicle.efficiencyKwhPer100Km * DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH) /
    100;

  return {
    purchasePriceWithVAT: Math.max(0, vehicle.priceEUR - incentive),
    incentivesApplied: incentive,
    estimatedEnergyCostMonthly: Math.round(monthlyEnergy),
    estimatedMonthlyTotal: Math.round((vehicle.monthlyLeaseEUR ?? vehicle.priceEUR / 60) + monthlyEnergy),
    leaseMonthly: vehicle.monthlyLeaseEUR,
    annualKmAssumption,
    electricityPriceEurPerKwh: DEFAULT_ELECTRICITY_PRICE_EUR_PER_KWH,
    assumptionsVersion: TCO_ASSUMPTIONS_VERSION,
    incentiveNote:
      incentive > 0
        ? "Configured Austrian BEV incentive applied from AUSTRIA_BEV_INCENTIVE_EUR."
        : "No purchase incentive configured; verify Austrian public incentives before staging."
  };
}

export function estimateAnnualKm(criteria: UserCriteria) {
  if (criteria.dailyKm) {
    const commuteKm = criteria.dailyKm * 220;
    const leisureKm = criteria.tripNeeds.includes("road_trip") ? 4500 : 2500;
    return Math.max(8000, Math.round(commuteKm + leisureKm));
  }

  if (criteria.tripNeeds.includes("city")) return 9000;
  if (criteria.tripNeeds.includes("road_trip")) return 16000;
  return 12000;
}

function getConfiguredIncentive(vehicle: Vehicle) {
  if (vehicle.condition !== "new") return 0;
  const raw = process.env.AUSTRIA_BEV_INCENTIVE_EUR;
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
