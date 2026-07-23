import fs from "node:fs";
import path from "node:path";
import { emptyCriteria } from "../lib/criteria.ts";
import { searchVehicles } from "../lib/repositories/vehicle-repository.ts";
import type { UserCriteria } from "../lib/types.ts";

for (const [key, value] of Object.entries(loadEnv(path.join(process.cwd(), ".env.local")))) {
  if (typeof value === "string") process.env[key] = value;
}
process.env.FLOWRYD_VEHICLE_EMBEDDING_SEARCH = "1";

const probes: Array<{ label: string; message: string; patch: Partial<UserCriteria> }> = [
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
  }
];

for (const probe of probes) {
  const criteria: UserCriteria = { ...emptyCriteria(probe.message), ...probe.patch };
  const started = Date.now();
  const vehicles = await searchVehicles(criteria, probe.message);
  const withText = vehicles.filter((v) => (v.textRank ?? 0) > 0);
  const share = vehicles.length ? withText.length / vehicles.length : 0;
  console.log(
    JSON.stringify(
      {
        label: probe.label,
        ms: Date.now() - started,
        returned: vehicles.length,
        textRankShare: Number(share.toFixed(3)),
        top: vehicles.slice(0, 5).map((v) => ({
          title: `${v.make} ${v.model}`,
          seats: v.seats,
          semantic: v.embeddingSimilarity ?? null,
          textRank: v.textRank ?? null
        }))
      },
      null,
      2
    )
  );
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
