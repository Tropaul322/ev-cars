import type { InventorySourceConfig } from "./types.ts";

const autoscoutListingPatterns = [/\/lst\//i, /\/angebote\//i, /\/offer\//i];
const gebrauchtwagenListingPatterns = [/\/fahrzeug\//i, /\/auto\//i, /\/detail\//i];

export const inventorySources: InventorySourceConfig[] = [
  {
    id: "autoscout24_at_ev_all",
    name: "AutoScout24 Austria EV listings",
    source: "autoscout24_at",
    kind: "inventory",
    // BEV search results page; ships the full result set as __NEXT_DATA__ JSON.
    url: "https://www.autoscout24.at/lst?atype=C&fuel=E&sort=standard&desc=0&cy=A&ustate=N%2CU",
    market: "AT",
    parser: "autoscout24",
    // AutoScout24's terms restrict automated querying; enabled under operator
    // authorization for this closed Austria pilot.
    permissionConfirmed: true,
    maxListingPages: 3,
    listingUrlPatterns: autoscoutListingPatterns,
    includeUrlPatterns: [/elektro/i, /electric/i, /kwh/i],
    notes: "AutoScout24 Austria electric-car search results, covering used and new offers."
  },
  {
    id: "autoscout24_at_ev_new",
    name: "AutoScout24 Austria new EV listings",
    source: "autoscout24_at",
    kind: "inventory",
    url: "https://www.autoscout24.at/lst?atype=C&fuel=E&sort=standard&desc=0&cy=A&ustate=N",
    market: "AT",
    parser: "autoscout24",
    permissionConfirmed: true,
    conditionHint: "new",
    sellerTypeHint: "dealer",
    maxListingPages: 2,
    listingUrlPatterns: autoscoutListingPatterns,
    includeUrlPatterns: [/elektro/i, /electric/i, /kwh/i],
    notes: "New-car focused AutoScout24 Austria EV entry point."
  },
  {
    id: "gebrauchtwagen_at_ev",
    name: "gebrauchtwagen.at EV listings",
    source: "gebrauchtwagen_at",
    kind: "inventory",
    // gebrauchtwagen.at is AutoScout24-operated; its /angebote pages carry the
    // same __NEXT_DATA__ listings. ?fuel=E filters to pure electric.
    url: "https://www.gebrauchtwagen.at/angebote?fuel=E",
    market: "AT",
    parser: "autoscout24",
    permissionConfirmed: true,
    maxListingPages: 2,
    listingUrlPatterns: gebrauchtwagenListingPatterns,
    includeUrlPatterns: [/elektro/i, /electric/i, /kwh/i],
    notes: "Austrian used-EV marketplace slice, parsed from embedded listings JSON."
  },
  {
    id: "willhaben_at_ev",
    name: "willhaben.at EV listings",
    source: "willhaben",
    kind: "inventory",
    // BEV filter: ENGINE/FUEL=100004 (pure electric). DataDome-protected;
    // fetched via stealth render. robots.txt forbids spiders — enabled only
    // under operator authorization for this closed Austria pilot.
    url: "https://www.willhaben.at/iad/gebrauchtwagen/auto/gebrauchtwagenboerse?ENGINE/FUEL=100004",
    market: "AT",
    parser: "willhaben",
    permissionConfirmed: true,
    notes: "willhaben BEV search results, parsed from embedded __NEXT_DATA__ JSON."
  },
  {
    id: "bmw_boerse_at",
    name: "bmw-boerse.at BMW i listings",
    source: "bmw_boerse_at",
    kind: "inventory",
    url: "https://www.bmw-boerse.at/autotypen/gebrauchte-bmw-suv-sav",
    market: "AT",
    parser: "bmw_boerse",
    conditionHint: "used",
    sellerTypeHint: "dealer",
    notes: "Server-rendered TYPO3 body-type pages; parser keeps only BMW battery-electric i models."
  },
  {
    id: "vw_austria_ev_leasing",
    name: "Volkswagen Austria EV offers",
    source: "vw_austria_ev_leasing",
    kind: "inventory",
    url: "https://www.volkswagen.at/angebote-und-aktionen/porsche-bank-aktionen/finanzierung/leasing/leasing-e-auto",
    market: "AT",
    parser: "generic_vehicle",
    waitFor: "body",
    conditionHint: "new",
    sellerTypeHint: "oem",
    maxListingPages: 1,
    listingUrlPatterns: [/\/id/i, /\/elektroauto/i, /leasing-e-auto/i],
    includeUrlPatterns: [/id\./i, /elektro/i, /leasing/i],
    notes: "Selected OEM Austria source for new Volkswagen EV offer pages."
  },
  {
    id: "volkswagen_at_ev_models",
    name: "Volkswagen Austria electric models",
    source: "oem",
    kind: "inventory",
    url: "https://www.volkswagen.at/elektroauto/elektroautos",
    market: "AT",
    parser: "generic_vehicle",
    waitFor: "body",
    conditionHint: "new",
    sellerTypeHint: "oem",
    maxListingPages: 1,
    listingUrlPatterns: [/\/id/i, /\/elektroauto/i],
    includeUrlPatterns: [/id\./i, /elektro/i],
    notes: "Selected OEM Austria source for Volkswagen new EV model pages."
  },
  {
    id: "bmw_austria_new_ev",
    name: "BMW Austria electric models",
    source: "oem",
    kind: "inventory",
    url: "https://www.bmw.at/de/neufahrzeuge/bmw-i.html",
    market: "AT",
    parser: "generic_vehicle",
    waitFor: "body",
    conditionHint: "new",
    sellerTypeHint: "oem",
    maxListingPages: 1,
    listingUrlPatterns: [/\/bmw-i/i, /\/neufahrzeuge/i],
    includeUrlPatterns: [/bmw-i/i, /elektro/i, /electric/i],
    notes: "Selected OEM Austria source for BMW new EV model pages."
  },
  {
    id: "mercedes_austria_new_ev",
    name: "Mercedes-Benz Austria electric models",
    source: "oem",
    kind: "inventory",
    url: "https://www.mercedes-benz.at/passengercars/models/electric.html",
    market: "AT",
    parser: "generic_vehicle",
    waitFor: "body",
    conditionHint: "new",
    sellerTypeHint: "oem",
    maxListingPages: 1,
    listingUrlPatterns: [/\/models\/electric/i, /\/eq/i, /\/electric/i],
    includeUrlPatterns: [/eq/i, /electric/i, /elektro/i],
    notes: "Selected OEM Austria source for Mercedes-Benz new EV model pages."
  },
  {
    id: "hyundai_austria_new_ev",
    name: "Hyundai Austria electric models",
    source: "oem",
    kind: "inventory",
    url: "https://www.hyundai.at/modelle",
    market: "AT",
    parser: "generic_vehicle",
    waitFor: "body",
    conditionHint: "new",
    sellerTypeHint: "oem",
    maxListingPages: 1,
    listingUrlPatterns: [/ioniq/i, /kona-elektro/i, /inster/i],
    includeUrlPatterns: [/ioniq/i, /elektro/i, /electric/i, /inster/i],
    notes: "Selected OEM Austria source for Hyundai new EV model pages."
  },
  {
    id: "kia_austria_new_ev",
    name: "Kia Austria electric models",
    source: "oem",
    kind: "inventory",
    url: "https://www.kia.com/at/modelle/",
    market: "AT",
    parser: "generic_vehicle",
    waitFor: "body",
    conditionHint: "new",
    sellerTypeHint: "oem",
    maxListingPages: 1,
    listingUrlPatterns: [/\/ev[0-9]/i, /\/niro-ev/i],
    includeUrlPatterns: [/ev[0-9]/i, /electric/i, /elektro/i],
    notes: "Selected OEM Austria source for Kia new EV model pages."
  },
  {
    id: "tesla_austria_new_inventory",
    name: "Tesla Austria inventory",
    source: "oem",
    kind: "inventory",
    url: "https://www.tesla.com/de_at/inventory/new/my",
    market: "AT",
    // Reads Tesla's public inventory JSON API (paginated). Akamai-gated:
    // yields 0 rows when bot-blocked, no substitution.
    parser: "tesla_api",
    teslaModels: ["m3", "my", "ms", "mx"],
    teslaConditions: ["new", "used"],
    sellerTypeHint: "oem",
    maxListingPages: 1,
    listingUrlPatterns: [/\/inventory\/new/i, /\/my\/order/i, /\/m3\/order/i, /\/mx\/order/i, /\/ms\/order/i],
    includeUrlPatterns: [/tesla/i, /model/i, /inventory/i],
    notes: "Tesla Austria new+used inventory via the public inventory-results API."
  },
  {
    id: "eletric_vehicles_news",
    name: "eletric-vehicles.com EV news",
    source: "oem",
    kind: "context",
    url: "https://eletric-vehicles.com/",
    market: "EU",
    parser: "rag_page",
    waitFor: "body",
    notes: "Industry/news context source requested by the user; archived as context, not direct inventory."
  },
  {
    id: "umweltfoerderung_private",
    name: "Umweltfoerderung private e-mobility subsidies",
    source: "oem",
    kind: "context",
    url: "https://www.umweltfoerderung.at/privatpersonen",
    market: "AT",
    parser: "rag_page",
    waitFor: "body",
    notes: "Official Austrian public-subvention context around private electric mobility and charging."
  },
  {
    id: "econtrol_charging_info",
    name: "E-Control public charging information",
    source: "oem",
    kind: "context",
    url: "https://www.e-control.at/ladestellenverzeichnis-technische-informationen",
    market: "AT",
    parser: "rag_page",
    waitFor: "body",
    notes: "Austrian public-charging registry and technical context for the knowledge corpus."
  },
  {
    id: "nearcharger_info",
    name: "NearCharger SK/CZ listing-platform context",
    source: "oem",
    kind: "context",
    url: "https://nearcharger.sk/",
    market: "SK",
    parser: "rag_page",
    waitFor: "body",
    notes: "Information-only source for the new SK/CZ listing platform."
  }
];

export function selectSources(sourceIds: Set<string>) {
  if (!sourceIds.size) return inventorySources;
  return inventorySources.filter((source) => sourceIds.has(source.id));
}
