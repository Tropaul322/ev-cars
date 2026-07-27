import type { Vehicle } from "../types.ts";

export type EvalScenario = {
  id: string;
  prompt: string;
  kind: "happy" | "adversarial";
  expectedMinMatches: number;
  expectedEligibleIds?: string[];
  acceptableTopKIds?: string[];
  requiredExplanationFacts?: Array<keyof Vehicle>;
};

export const evalScenarios: EvalScenario[] = [
  {
    id: "de-city-budget-wallbox-missing",
    prompt: "Ich suche ein E-Auto fuer Wien, keine Wallbox, 400 km Reichweite.",
    kind: "adversarial",
    expectedMinMatches: 0
  },
  {
    id: "de-city-compact",
    prompt: "Ich wohne in Wien, Budget 35000 EUR, gebraucht ok, kompakt, CarPlay und Sitzheizung.",
    kind: "happy",
    expectedMinMatches: 2,
    expectedEligibleIds: [
      "vw-id3-pro-2023",
      "mg4-luxury-2024",
      "renault-megane-etech-2023",
      "fiat-500e-icon-2022"
    ],
    acceptableTopKIds: ["fiat-500e-icon-2022", "vw-id3-pro-2023"],
    requiredExplanationFacts: ["priceEUR", "rangeKm"]
  },
  {
    id: "de-family-suv",
    prompt: "Familien-SUV bis 50000 EUR, grosser Kofferraum, Autobahn, mindestens 450 km Reichweite.",
    kind: "happy",
    expectedMinMatches: 2,
    expectedEligibleIds: [
      "audi-q4-40-2023",
      "tesla-model-y-used-2024-blue",
      "xpeng-g6-rwd-2024",
      "skoda-enyaq-85-2024"
    ],
    acceptableTopKIds: ["skoda-enyaq-85-2024", "xpeng-g6-rwd-2024"],
    requiredExplanationFacts: ["priceEUR", "rangeKm", "seats"]
  },
  {
    id: "de-premium-roadtrip",
    prompt: "Premium E-Auto bis 60000 EUR fuer Langstrecke, gute Assistenzsysteme und Sound.",
    kind: "happy",
    expectedMinMatches: 3,
    acceptableTopKIds: [
      "mercedes-eqa-250-2024",
      "polestar-2-longrange-2023",
      "bmw-i4-edrive40-2022"
    ],
    requiredExplanationFacts: ["priceEUR", "rangeKm"]
  },
  {
    id: "de-used-battery",
    prompt: "Gebrauchtes Elektroauto bis 42000 EUR, Batteriegesundheit wichtig, Pendeln 70 km taeglich.",
    kind: "happy",
    expectedMinMatches: 2,
    expectedEligibleIds: [
      "vw-id3-pro-2023",
      "kia-ev6-air-2022",
      "mg4-luxury-2024",
      "tesla-model-3-used-2024-blue",
      "tesla-model-3-used-2023-red",
      "byd-atto3-design-2024"
    ],
    acceptableTopKIds: ["vw-id3-pro-2023", "kia-ev6-air-2022"],
    requiredExplanationFacts: ["priceEUR", "rangeKm"]
  },
  {
    id: "de-impossible-budget",
    prompt: "Ich brauche einen neuen SUV mit 600 km Reichweite fuer 15000 EUR.",
    kind: "adversarial",
    expectedMinMatches: 0
  },
  {
    id: "de-chinese-tech",
    prompt: "Neues chinesisches E-Auto bis 47000 EUR, viel Technik, Totwinkel und lange Reichweite.",
    kind: "happy",
    expectedMinMatches: 2,
    expectedEligibleIds: [
      "mg4-luxury-2024",
      "byd-atto3-design-2024",
      "xpeng-g6-rwd-2024"
    ],
    acceptableTopKIds: ["mg4-luxury-2024", "byd-atto3-design-2024"],
    requiredExplanationFacts: ["priceEUR", "rangeKm"]
  },
  {
    id: "de-winter-awd",
    prompt: "E-Auto bis 56000 EUR fuer Berge und Winter, Allrad, Sitzheizung, 450 km Reichweite.",
    kind: "happy",
    expectedMinMatches: 1,
    expectedEligibleIds: [
      "tesla-model-3-new-2024-white",
      "tesla-model-y-long-range-2025",
      "tesla-model-y-used-2024-blue",
      "nio-et5-touring-2024"
    ],
    acceptableTopKIds: ["tesla-model-3-new-2024-white", "tesla-model-y-long-range-2025"],
    requiredExplanationFacts: ["priceEUR", "rangeKm"]
  },
  {
    id: "de-no-tesla",
    prompt: "Budget 45000 EUR, keine Tesla, Pendeln und Wochenendfahrten, gute Effizienz.",
    kind: "happy",
    expectedMinMatches: 3,
    expectedEligibleIds: [
      "kia-ev6-air-2022",
      "polestar-2-longrange-2023",
      "mg4-luxury-2024",
      "volvo-ex30-extended-2024",
      "hyundai-ioniq5-2023",
      "byd-atto3-design-2024"
    ],
    acceptableTopKIds: ["kia-ev6-air-2022", "polestar-2-longrange-2023"],
    requiredExplanationFacts: ["priceEUR", "rangeKm"]
  },
  {
    id: "de-monthly-budget",
    prompt: "Leasing maximal 450 EUR im Monat, Stadt und Pendeln, CarPlay und Tempomat.",
    kind: "happy",
    expectedMinMatches: 3,
    expectedEligibleIds: [
      "vw-id3-pro-2023",
      "kia-ev6-air-2022",
      "mg4-luxury-2024",
      "byd-atto3-design-2024",
      "renault-megane-etech-2023"
    ],
    acceptableTopKIds: ["mg4-luxury-2024", "byd-atto3-design-2024"],
    requiredExplanationFacts: ["rangeKm", "seats", "cargoLiters"]
  },
  {
    id: "de-contradictory-condition",
    prompt: "Nur Neuwagen und nur gebraucht, Budget 30000 EUR, 500 km Reichweite.",
    kind: "adversarial",
    expectedMinMatches: 0
  },
  {
    id: "de-tiny-city",
    prompt: "Kleines E-Auto fuer die Stadt bis 25000 EUR, einfache Parkplatzsuche, 30 km taeglich.",
    kind: "happy",
    expectedMinMatches: 1,
    expectedEligibleIds: ["fiat-500e-icon-2022"],
    acceptableTopKIds: ["fiat-500e-icon-2022"],
    requiredExplanationFacts: ["priceEUR", "rangeKm", "seats"]
  }
];
