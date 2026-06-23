import {
  demoCars,
  demoListingsByModel,
  demoSummaries,
  type DemoCar,
} from "@/lib/flowryd-demo-data";
import type { MatchResult, ScoringBreakdown, Vehicle } from "@/lib/types";

const previewModelIds = ["tesla-model-y", "cadillac-lyriq"] as const;

function parsePriceEUR(price: string) {
  return Number(price.replace(/[^0-9.]/g, ""));
}

function parseRangeKm(range: string) {
  const miles = Number(range.replace(/[^0-9.]/g, ""));
  return Math.round(miles * 1.60934);
}

function parseMileageKm(mileage?: string) {
  if (!mileage) return null;
  const miles = Number(mileage.replace(/[^0-9.]/g, ""));
  return Number.isFinite(miles) ? Math.round(miles * 1.60934) : null;
}

function demoModelName(car: DemoCar) {
  return car.name.replace(new RegExp(`^${car.brand}\\s*`, "i"), "").trim() || car.name;
}

function demoCarToVehicle(car: DemoCar, listingIndex: number): Vehicle {
  const priceEUR = parsePriceEUR(car.price);
  return {
    id: listingIndex === 0 ? car.id : `${car.id}-listing-${listingIndex}`,
    source: "seed",
    market: "AT",
    make: car.brand,
    model: demoModelName(car),
    trim: car.variant,
    year: car.year,
    priceEUR,
    monthlyLeaseEUR: null,
    condition: car.condition === "New" ? "new" : "used",
    mileageKm: parseMileageKm(car.mileage),
    rangeKm: parseRangeKm(car.range),
    efficiencyKwhPer100Km: 18,
    batteryKwh: 75,
    batterySoH: car.condition === "New" ? null : 94,
    chargingCycles: null,
    warranty: "Demo preview",
    bodyType: "suv",
    seats: 5,
    cargoLiters: 800,
    drivetrain: "AWD",
    powerKw: 250,
    available: true,
    features: [],
    images: [car.image],
    location: car.location,
    notes: car.exterior,
    brandOrigin: "us",
    reviewTags: [],
  };
}

const previewScoring: ScoringBreakdown = {
  priceFit: 92,
  rangeFit: 95,
  efficiencyFit: 88,
  brandFit: 85,
  cargoPassengerFit: 90,
  reliabilityFit: 88,
  featureFit: 92,
};

function demoCarToMatchResult(car: DemoCar, listingIndex: number): MatchResult {
  const vehicle = demoCarToVehicle(car, listingIndex);
  const priceEUR = parsePriceEUR(car.price);

  return {
    vehicle,
    score: car.match,
    ragScore: 74,
    ragEvidence: [],
    hardFilterStatus: "passed",
    scoringBreakdown: previewScoring,
    explanation: demoSummaries[car.id] ?? "Strong match for your daily driving needs.",
    ruledOutReasons: [],
    tco: {
      purchasePriceWithVAT: priceEUR,
      incentivesApplied: 0,
      estimatedEnergyCostMonthly: 85,
      estimatedMonthlyTotal: 85,
      leaseMonthly: null,
      annualKmAssumption: 15000,
      electricityPriceEurPerKwh: 0.28,
      assumptionsVersion: "preview",
      incentiveNote: "Preview only — register to see real Austrian pricing.",
    },
  };
}

export function buildMockMatchPreview(): MatchResult[] {
  return previewModelIds.flatMap((modelId) => {
    const listings = demoListingsByModel[modelId] ?? [demoCars[modelId]];
    return listings.map((car, index) => demoCarToMatchResult(car, index));
  });
}

export const mockPreviewAssistantMessage =
  "Based on your request, here are your strongest matches today. Join the demo to unlock full details and real inventory.";

export const mockPreviewDelayMs = 1600;
