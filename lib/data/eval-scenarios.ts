export type EvalScenario = {
  id: string;
  prompt: string;
  kind: "happy" | "adversarial";
  expectedMinMatches: number;
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
    expectedMinMatches: 2
  },
  {
    id: "de-family-suv",
    prompt: "Familien-SUV bis 50000 EUR, grosser Kofferraum, Autobahn, mindestens 450 km Reichweite.",
    kind: "happy",
    expectedMinMatches: 2
  },
  {
    id: "de-premium-roadtrip",
    prompt: "Premium E-Auto bis 60000 EUR fuer Langstrecke, gute Assistenzsysteme und Sound.",
    kind: "happy",
    expectedMinMatches: 3
  },
  {
    id: "de-used-battery",
    prompt: "Gebrauchtes Elektroauto bis 42000 EUR, Batteriegesundheit wichtig, Pendeln 70 km taeglich.",
    kind: "happy",
    expectedMinMatches: 2
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
    expectedMinMatches: 2
  },
  {
    id: "de-winter-awd",
    prompt: "E-Auto bis 56000 EUR fuer Berge und Winter, Allrad, Sitzheizung, 450 km Reichweite.",
    kind: "happy",
    expectedMinMatches: 1
  },
  {
    id: "de-no-tesla",
    prompt: "Budget 45000 EUR, keine Tesla, Pendeln und Wochenendfahrten, gute Effizienz.",
    kind: "happy",
    expectedMinMatches: 3
  },
  {
    id: "de-monthly-budget",
    prompt: "Leasing maximal 450 EUR im Monat, Stadt und Pendeln, CarPlay und Tempomat.",
    kind: "happy",
    expectedMinMatches: 3
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
    expectedMinMatches: 1
  }
];
