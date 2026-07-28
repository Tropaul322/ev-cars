import fs from "node:fs";
import path from "node:path";
import { emptyCriteria } from "../lib/criteria.ts";
import { allVehicles } from "../lib/data/all-vehicles.ts";
import { diversifyRecommendations, resolveMaxPerBrand } from "../lib/recommendation-diversity.ts";
import { searchVehicles } from "../lib/repositories/vehicle-repository.ts";
import { matchVehicles } from "../lib/scoring.ts";
import type { MatchResult, UserCriteria, Vehicle } from "../lib/types.ts";

for (const [key, value] of Object.entries(loadEnv(path.join(process.cwd(), ".env.local")))) {
  if (typeof value === "string") process.env[key] = value;
}
process.env.FLOWRYD_VEHICLE_EMBEDDING_SEARCH = "1";

const PREMIUM_MAKES = new Set(["audi", "bmw", "mercedes", "polestar", "volvo", "porsche", "nio"]);

type Probe = {
  label: string;
  message: string;
  patch: Partial<UserCriteria>;
  validate?: (ranked: MatchResult[], retrieved: Vehicle[]) => ValidationResult;
};

type ValidationResult = {
  ok: boolean;
  checks: Record<string, boolean | number | string>;
};

const probes: Probe[] = [
  {
    label: "sporty-2-seater",
    message: "sporty 2 seater convertible electric car",
    patch: { optimizationDirective: "performance", passengers: 2, budgetMaxEUR: 80000 }
  },
  {
    label: "city-cheap",
    message: "small cheap city car for Vienna commuting",
    patch: { tripNeeds: ["city", "commute"], budgetMaxEUR: 25000, chargingAccess: "public" }
  },
  {
    label: "family-suv",
    message: "family SUV with long range for highway trips Austria",
    patch: { tripNeeds: ["family", "road_trip"], bodyTypes: ["suv"], budgetMaxEUR: 60000 }
  },
  {
    label: "brand-exact",
    message: "Tesla Model 3",
    patch: { brandPreferences: ["Tesla"], modelPreferences: ["Model 3"] }
  },
  {
    label: "premium-status",
    message: "premium prestige status electric car with a luxury feel",
    patch: {
      personalWish: "status",
      qualitativeSignals: ["premium"],
      brandFit: "high",
      budgetMaxEUR: 90000,
      rangeFloorKm: 350
    },
    validate: (ranked) => {
      const top = ranked.slice(0, 5);
      const premiumInTop = top.filter((match) => PREMIUM_MAKES.has(normalizeMake(match.vehicle.make)));
      const premiumShare = top.length ? premiumInTop.length / top.length : 0;
      const avgBrandFit =
        top.reduce((sum, match) => sum + match.scoringBreakdown.brandFit, 0) / Math.max(top.length, 1);
      const checks = {
        returnedAtLeast3: ranked.length >= 3,
        premiumCountInTop5: premiumInTop.length,
        premiumShareInTop5: Number(premiumShare.toFixed(3)),
        avgBrandFitInTop5: Math.round(avgBrandFit),
        topMakes: top.map((match) => match.vehicle.make).join(", ")
      };
      return {
        ok: checks.returnedAtLeast3 && premiumInTop.length >= 2 && avgBrandFit >= 70,
        checks
      };
    }
  },
  {
    label: "best-price-to-performance",
    message: "best price-to-performance value for money EV under 50000",
    patch: {
      optimizationDirective: "best_value",
      budgetMaxEUR: 50000,
      rangeFloorKm: 300,
      bodyTypes: ["suv", "sedan", "compact", "hatchback", "wagon"]
    },
    validate: (ranked, retrieved) => {
      const top = ranked.slice(0, 5);
      const pool = retrieved.length ? retrieved : ranked.map((match) => match.vehicle);
      const poolAvgPrice = average(pool.map((vehicle) => vehicle.priceEUR));
      const topAvgPrice = average(top.map((match) => match.vehicle.priceEUR));
      const poolAvgValue = average(pool.map((vehicle) => valueScore(vehicle)));
      const topAvgValue = average(top.map((match) => valueScore(match.vehicle)));
      const avgPriceFit =
        top.reduce((sum, match) => sum + match.scoringBreakdown.priceFit, 0) / Math.max(top.length, 1);
      const checks = {
        returnedAtLeast3: ranked.length >= 3,
        topAvgPriceEUR: Math.round(topAvgPrice),
        poolAvgPriceEUR: Math.round(poolAvgPrice),
        topAvgKmPerEuro: Number(topAvgValue.toFixed(3)),
        poolAvgKmPerEuro: Number(poolAvgValue.toFixed(3)),
        avgPriceFitInTop5: Math.round(avgPriceFit),
        topTitles: top
          .map((match) => `${match.vehicle.make} ${match.vehicle.model} €${match.vehicle.priceEUR}`)
          .join(" | ")
      };
      return {
        ok:
          checks.returnedAtLeast3 &&
          topAvgPrice <= poolAvgPrice * 1.05 &&
          topAvgValue >= poolAvgValue * 0.95 &&
          avgPriceFit >= 60,
        checks
      };
    }
  }
];

let failures = 0;

for (const probe of probes) {
  const criteria: UserCriteria = { ...emptyCriteria(probe.message), ...probe.patch };
  const started = Date.now();
  let vehicles = await searchVehicles(criteria, probe.message);
  let retrievalSource: "search" | "bundled-fallback" = "search";
  if (!vehicles.length) {
    vehicles = allVehicles;
    retrievalSource = "bundled-fallback";
  }
  const rankedRaw = matchVehicles(vehicles, criteria, Math.min(24, Math.max(vehicles.length, 1))).recommendations;
  const ranked = diversifyRecommendations(rankedRaw, 10, {
    maxPerModel: 2,
    maxPerListing: 1,
    maxPerBrand: resolveMaxPerBrand(criteria.brandPreferences, 1)
  });
  const withText = vehicles.filter((v) => (v.textRank ?? 0) > 0);
  const share = vehicles.length ? withText.length / vehicles.length : 0;
  const validation = probe.validate?.(ranked, vehicles);

  if (validation && !validation.ok) failures += 1;

  console.log(
    JSON.stringify(
      {
        label: probe.label,
        ms: Date.now() - started,
        returned: vehicles.length,
        retrievalSource,
        textRankShare: Number(share.toFixed(3)),
        validation: validation
          ? { ok: validation.ok, ...validation.checks }
          : undefined,
        top: (ranked.length ? ranked.slice(0, 5) : null)?.map((match) => ({
          title: `${match.vehicle.make} ${match.vehicle.model}`,
          seats: match.vehicle.seats,
          priceEUR: match.vehicle.priceEUR,
          rangeKm: match.vehicle.rangeKm,
          score: match.score,
          brandFit: match.scoringBreakdown.brandFit,
          priceFit: match.scoringBreakdown.priceFit,
          semantic: match.vehicle.embeddingSimilarity ?? null,
          textRank: match.vehicle.textRank ?? null
        })) ??
          vehicles.slice(0, 5).map((vehicle) => ({
            title: `${vehicle.make} ${vehicle.model}`,
            seats: vehicle.seats,
            priceEUR: vehicle.priceEUR,
            rangeKm: vehicle.rangeKm,
            score: null,
            brandFit: null,
            priceFit: null,
            semantic: vehicle.embeddingSimilarity ?? null,
            textRank: vehicle.textRank ?? null
          }))
      },
      null,
      2
    )
  );
}

if (failures > 0) {
  console.error(`\nProbe validations failed: ${failures}`);
  process.exitCode = 1;
} else {
  console.log("\nAll probe validations passed (or had no validators).");
}

function normalizeMake(make: string) {
  return make.trim().toLowerCase().replace(/\s+/g, " ");
}

function valueScore(vehicle: Vehicle) {
  if (!vehicle.priceEUR || vehicle.priceEUR <= 0) return 0;
  return vehicle.rangeKm / vehicle.priceEUR;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return process.env;
  const values = { ...process.env } as Record<string, string | undefined>;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    values[trimmed.slice(0, sep)] = trimmed.slice(sep + 1);
  }
  return values;
}
