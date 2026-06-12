const VIN_PATTERN = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;

const VIN_LABEL_PATTERN =
  /(?:fahrgestell(?:nummer)?|fahrzeug[-\s]?ident(?:ifikationsnummer)?|vin|fin)\s*[:#]?\s*([A-HJ-NPR-Z0-9]{17})\b/i;

const VIN_BLOCKLIST = new Set([
  "FAHRZEUGBEWERTUNG",
  "KUNDENBEWERTUNGEN",
  "STRASSENZULASSUNG",
  "FAHRZEUGSTEUERUNG",
  "VERBRAUCHERRECHTE",
  "CKRAUMBELEUCHTUNG",
  "DECKENRAUMBELEUCHT",
  "KLIMAAUTOMATIK",
  "GESCHWINDIGKEITS",
  "REGISTRIERUNG",
  "UNTERHALTUNG",
  "KOMFORTPAKET",
  "SICHERHEITSPAKET"
]);

const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9
};

const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeVin(value: string | null | undefined) {
  if (!value) return null;
  const vin = value.replace(/[\s-]/g, "").toUpperCase();
  return isPlausibleVin(vin) ? vin : null;
}

export function parseVinFromText(text: string) {
  const labeled = text.match(VIN_LABEL_PATTERN);
  if (labeled?.[1]) {
    const vin = normalizeVin(labeled[1]);
    if (vin) return vin;
  }

  for (const match of text.matchAll(VIN_PATTERN)) {
    const vin = normalizeVin(match[1]);
    if (vin) return vin;
  }

  return null;
}

export function parseVinFromJsonLd(node: Record<string, unknown> | undefined) {
  if (!node) return null;
  const candidates = [
    node.vehicleIdentificationNumber,
    node.vin,
    node.serialNumber,
    (node.identifier as Record<string, unknown> | undefined)?.value
  ];

  for (const candidate of candidates) {
    const vin = normalizeVin(stringValue(candidate));
    if (vin) return vin;
  }

  return null;
}

export function isPlausibleVin(value: string) {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) return false;
  if (VIN_BLOCKLIST.has(value)) return false;
  if (!/\d/.test(value)) return false;
  if ((value.match(/\d/g) ?? []).length < 4) return false;
  if (/^[A-Z]{17}$/.test(value)) return false;
  return hasValidVinChecksum(value);
}

function hasValidVinChecksum(vin: string) {
  let sum = 0;

  for (let index = 0; index < 17; index++) {
    const char = vin[index];
    const value =
      char >= "0" && char <= "9" ? Number(char) : VIN_TRANSLITERATION[char];
    if (value === undefined) return false;
    sum += value * VIN_WEIGHTS[index];
  }

  const remainder = sum % 11;
  const expected = remainder === 10 ? "X" : String(remainder);
  return vin[8] === expected;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
