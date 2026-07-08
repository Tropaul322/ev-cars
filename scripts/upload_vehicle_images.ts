import fs from "node:fs";
import path from "node:path";
import { getSupabaseRestConfig } from "../lib/repositories/supabase-rest.ts";
import type { Vehicle } from "../lib/types.ts";

type UploadOptions = {
  imagesRoot: string;
  catalogCsv: string;
  allMatching: boolean;
  dryRun: boolean;
  limit: number | null;
};

type VehicleRow = {
  id: string;
  make: string | null;
  model: string | null;
  payload: Vehicle;
};

type ModelFolder = {
  brandFolder: string;
  modelFolder: string;
  make: string;
  model: string;
  files: string[];
};

type UploadSummary = {
  folders: number;
  filesUploaded: number;
  vehiclesUpdated: number;
  unmatchedFolders: string[];
  vehiclesWithoutImages: string[];
};

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);
const root = process.cwd();
const env = loadEnv(path.join(root, ".env.local"));
for (const [key, value] of Object.entries(env)) {
  if (typeof value === "string") process.env[key] = value;
}

const options = parseArgs(process.argv.slice(2));
const supabase = getSupabaseRestConfig();

if (!supabase && !options.dryRun) {
  throw new Error(
    "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, or pass --dry-run."
  );
}

const modelFolders = discoverModelFolders(options.imagesRoot);
const selectedFolders = options.limit === null ? modelFolders : modelFolders.slice(0, options.limit);

console.log(
  `Vehicle images: folders=${selectedFolders.length}/${modelFolders.length}, root=${options.imagesRoot}, allMatching=${options.allMatching}, dryRun=${options.dryRun}`
);

if (options.dryRun) {
  const catalogVehicles = loadCatalogVehicles(options.catalogCsv);
  const vehiclesByKey = groupVehiclesByMakeModel(catalogVehicles);
  for (const folder of selectedFolders) {
    const ordered = orderImageFiles(folder.files);
    const matches = findMatchingVehicles(folder, vehiclesByKey);
    console.log(`${folder.make} / ${folder.model}: ${ordered.length} images -> ${matches.length} vehicles`);
    console.log(`  storage: ${buildStoragePrefix(folder)}/`);
    console.log(`  primary: ${path.basename(ordered[0] ?? "(none)")}`);
    if (matches.length) {
      console.log(`  ids: ${matches.map((vehicle) => vehicle.id).join(", ")}`);
    }
  }
  process.exit(0);
}

const vehicles = options.allMatching
  ? await fetchAllVehicles(supabase!)
  : await fetchCatalogVehicles(supabase!, options.catalogCsv);
const summary = await uploadAndUpdate(supabase!, selectedFolders, vehicles);
console.table([summary]);

async function uploadAndUpdate(
  config: NonNullable<ReturnType<typeof getSupabaseRestConfig>>,
  folders: ModelFolder[],
  vehicles: VehicleRow[]
): Promise<UploadSummary> {
  const summary: UploadSummary = {
    folders: folders.length,
    filesUploaded: 0,
    vehiclesUpdated: 0,
    unmatchedFolders: [],
    vehiclesWithoutImages: []
  };

  const vehiclesByKey = groupVehiclesByMakeModel(vehicles);
  const updatedVehicleIds = new Set<string>();
  const uploadedFolderKeys = new Set<string>();

  for (const folder of folders) {
    const matches = findMatchingVehicles(folder, vehiclesByKey);

    if (!matches.length) {
      summary.unmatchedFolders.push(`${folder.brandFolder}/${folder.modelFolder} -> ${folder.make}/${folder.model}`);
      continue;
    }

    const orderedFiles = orderImageFiles(folder.files);
    const folderKey = buildStoragePrefix(folder);
    let imageUrls: string[] = [];

    if (uploadedFolderKeys.has(folderKey)) {
      imageUrls = orderedFiles.map((filePath) =>
        publicStorageUrl(
          config.url,
          `${folderKey}/${sanitizeStorageFileName(path.basename(filePath))}`
        )
      );
    } else {
      for (const filePath of orderedFiles) {
        const storagePath = `${folderKey}/${sanitizeStorageFileName(path.basename(filePath))}`;
        await uploadFile(config, storagePath, filePath);
        imageUrls.push(publicStorageUrl(config.url, storagePath));
        summary.filesUploaded += 1;
      }
      uploadedFolderKeys.add(folderKey);
    }

    for (const vehicle of matches) {
      const nextPayload: Vehicle = {
        ...vehicle.payload,
        images: imageUrls
      };

      const response = await fetch(`${config.url}/rest/v1/vehicles?on_conflict=id`, {
        method: "POST",
        headers: {
          ...config.headers,
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({
          id: vehicle.id,
          payload: nextPayload
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to update vehicle ${vehicle.id}: ${response.status} ${await response.text()}`);
      }

      updatedVehicleIds.add(vehicle.id);
    }
  }

  summary.vehiclesUpdated = updatedVehicleIds.size;

  for (const vehicle of vehicles) {
    if (!updatedVehicleIds.has(vehicle.id) && isTargetBrand(vehicle.make)) {
      summary.vehiclesWithoutImages.push(`${vehicle.id} (${vehicle.make} ${vehicle.model})`);
    }
  }

  return summary;
}

async function uploadFile(
  config: NonNullable<ReturnType<typeof getSupabaseRestConfig>>,
  storagePath: string,
  filePath: string
) {
  const body = fs.readFileSync(filePath);
  const contentType = mimeTypeForPath(filePath);

  const response = await fetch(`${config.url}/storage/v1/object/vehicles_images/${encodeStoragePath(storagePath)}`, {
    method: "POST",
    headers: {
      apikey: config.headers.apikey,
      Authorization: config.headers.Authorization,
      "Content-Type": contentType,
      "x-upsert": "true"
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Storage upload failed for ${storagePath}: ${response.status} ${await response.text()}`);
  }
}

async function fetchCatalogVehicles(
  config: NonNullable<ReturnType<typeof getSupabaseRestConfig>>,
  catalogCsv: string
): Promise<VehicleRow[]> {
  const catalogRows = loadCatalogVehicles(catalogCsv);
  const ids = catalogRows.map((row) => row.id);
  const rows: VehicleRow[] = [];

  for (const idChunk of chunk(ids, 50)) {
    const filter = `id=in.(${idChunk.map((id) => `"${id}"`).join(",")})`;
    const response = await fetch(
      `${config.url}/rest/v1/vehicles?select=id,make,model,payload&${filter}`,
      { headers: config.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch catalog vehicles: ${response.status} ${await response.text()}`);
    }

    rows.push(...((await response.json()) as VehicleRow[]));
  }

  return rows;
}

async function fetchAllVehicles(config: NonNullable<ReturnType<typeof getSupabaseRestConfig>>): Promise<VehicleRow[]> {
  const rows: VehicleRow[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const response = await fetch(
      `${config.url}/rest/v1/vehicles?select=id,make,model,payload&order=id&limit=${pageSize}&offset=${offset}`,
      { headers: config.headers }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch vehicles: ${response.status} ${await response.text()}`);
    }

    const page = (await response.json()) as VehicleRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function loadCatalogVehicles(catalogCsv: string): VehicleRow[] {
  const content = fs.readFileSync(catalogCsv, "utf8").trim();
  const [headerLine, ...lines] = content.split(/\r?\n/);
  const headers = headerLine.split(",");
  const makeIndex = headers.indexOf("make");
  const modelIndex = headers.indexOf("model");
  const idIndex = headers.indexOf("id");

  return lines
    .filter(Boolean)
    .map((line) => {
      const columns = parseCsvLine(line);
      return {
        id: columns[idIndex] ?? "",
        make: columns[makeIndex] ?? null,
        model: columns[modelIndex] ?? null,
        // Dry-run catalog stubs only need id/make/model for matching; live uploads use full DB payloads.
        payload: {
          id: columns[idIndex] ?? "",
          make: columns[makeIndex] ?? "",
          model: columns[modelIndex] ?? "",
          source: "oem",
          market: "AT",
          condition: "new",
          available: true,
          features: [],
          images: []
        } as unknown as Vehicle
      };
    })
    .filter((row) => row.id);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function findMatchingVehicles(folder: ModelFolder, vehiclesByKey: Map<string, VehicleRow[]>) {
  const keys = modelMatchKeys(folder.make, folder.model);
  const matches = new Map<string, VehicleRow>();

  for (const key of keys) {
    for (const vehicle of vehiclesByKey.get(key) ?? []) {
      matches.set(vehicle.id, vehicle);
    }
  }

  return [...matches.values()];
}

function modelMatchKeys(make: string, model: string) {
  const keys = new Set<string>([makeModelKey(make, model)]);

  if (normalizeKey(make) === "xpeng" && normalizeKey(model) === "p7 plus") {
    keys.add(makeModelKey("XPENG", "P7+"));
    keys.add(makeModelKey("Xpeng", "P7"));
  }

  return [...keys];
}

function discoverModelFolders(imagesRoot: string): ModelFolder[] {
  const folders: ModelFolder[] = [];

  for (const brandEntry of fs.readdirSync(imagesRoot, { withFileTypes: true })) {
    if (!brandEntry.isDirectory()) continue;

    const brandFolder = brandEntry.name;
    const brandPath = path.join(imagesRoot, brandFolder);

    for (const modelEntry of fs.readdirSync(brandPath, { withFileTypes: true })) {
      if (!modelEntry.isDirectory()) continue;

      const modelFolder = modelEntry.name;
      const modelPath = path.join(brandPath, modelFolder);
      const files = fs
        .readdirSync(modelPath)
        .map((name) => path.join(modelPath, name))
        .filter((filePath) => IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

      if (!files.length) continue;

      const mapped = mapFolderToMakeModel(brandFolder, modelFolder);
      folders.push({
        brandFolder,
        modelFolder,
        make: mapped.make,
        model: mapped.model,
        files
      });
    }
  }

  return folders.sort((a, b) => `${a.make}/${a.model}`.localeCompare(`${b.make}/${b.model}`));
}

function mapFolderToMakeModel(brandFolder: string, modelFolder: string): { make: string; model: string } {
  const brandKey = normalizeKey(brandFolder);
  const modelKey = normalizeKey(modelFolder);

  const brandAliases: Record<string, string> = {
    "kgm ssangyong": "KGM",
    kgm: "KGM",
    aion: "AION",
    byd: "BYD",
    leapmotor: "Leapmotor",
    lucid: "Lucid",
    nio: "NIO",
    polestar: "Polestar",
    xpeng: "XPENG"
  };

  const make = brandAliases[brandKey] ?? titleCase(brandFolder);

  if (brandKey === "aion") {
    if (modelKey === "model v" || modelKey === "modelv" || modelKey === "model_v") return { make, model: "V" };
    if (modelKey === "model ut" || modelKey === "modelut" || modelKey === "model_ut") return { make, model: "UT" };
  }

  if (brandKey === "lucid") {
    if (modelKey.includes("air")) return { make, model: "Air" };
    if (modelKey.includes("gravity")) return { make, model: "Gravity" };
  }

  if (brandKey === "polestar") {
    const match = modelFolder.match(/polestar\s*(\d+)/i);
    if (match) return { make, model: match[1] };
  }

  if (brandKey === "byd") {
    return { make, model: modelFolder.toUpperCase() };
  }

  if (brandKey === "xpeng") {
    return { make, model: modelFolder.toUpperCase() };
  }

  return { make, model: modelFolder };
}

function orderImageFiles(files: string[]) {
  return [...files].sort((a, b) => scoreImageFile(a) - scoreImageFile(b) || a.localeCompare(b));
}

function scoreImageFile(filePath: string) {
  const name = path.basename(filePath).toLowerCase();
  if (/(^|[^a-z])front([^a-z]|$)/.test(name) && !/interior/.test(name)) return 0;
  if (/(side|3_4|3-4|angle)/.test(name)) return 10;
  if (/(rear|back|heck)/.test(name) && !/front/.test(name)) return 20;
  if (/interior|dashboard|cockpit|inside/.test(name)) return 30;
  return 15;
}

function groupVehiclesByMakeModel(vehicles: VehicleRow[]) {
  const map = new Map<string, VehicleRow[]>();
  for (const vehicle of vehicles) {
    const make = vehicle.make ?? vehicle.payload.make;
    const model = vehicle.model ?? vehicle.payload.model;
    const key = makeModelKey(make, model);
    const rows = map.get(key) ?? [];
    rows.push(vehicle);
    map.set(key, rows);
  }
  return map;
}

function makeModelKey(make: string | null | undefined, model: string | null | undefined) {
  return `${normalizeKey(make ?? "")}|${normalizeKey(model ?? "")}`;
}

function isTargetBrand(make: string | null | undefined) {
  const key = normalizeKey(make ?? "");
  return ["aion", "byd", "kgm", "leapmotor", "lucid", "nio", "polestar", "xpeng"].includes(key);
}

function buildStoragePrefix(folder: ModelFolder) {
  return `${slug(folder.make)}/${slug(folder.model)}`;
}

function publicStorageUrl(supabaseUrl: string, storagePath: string) {
  return `${supabaseUrl}/storage/v1/object/public/vehicles_images/${encodeStoragePath(storagePath)}`;
}

function encodeStoragePath(storagePath: string) {
  return storagePath.split("/").map(encodeURIComponent).join("/");
}

function sanitizeStorageFileName(fileName: string) {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function mimeTypeForPath(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

function normalizeKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s+]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\+/g, "-plus")
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function parseArgs(args: string[]): UploadOptions {
  const optionsValue: UploadOptions = {
    imagesRoot: path.join(root, "data", "Project Flowryd - Prototype Vehicle Images"),
    catalogCsv: path.join(root, "data", "imports", "new-brands", "all-new-brands.csv"),
    allMatching: false,
    dryRun: false,
    limit: null
  };

  for (const arg of args) {
    if (arg === "--dry-run") optionsValue.dryRun = true;
    else if (arg === "--all-matching") optionsValue.allMatching = true;
    else if (arg.startsWith("--limit=")) optionsValue.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--root=")) optionsValue.imagesRoot = path.resolve(arg.slice("--root=".length));
    else if (arg.startsWith("--catalog=")) optionsValue.catalogCsv = path.resolve(arg.slice("--catalog=".length));
  }

  return optionsValue;
}

function chunk<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return process.env;
  const values: Record<string, string> = { ...process.env } as Record<string, string>;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }

  return values;
}
