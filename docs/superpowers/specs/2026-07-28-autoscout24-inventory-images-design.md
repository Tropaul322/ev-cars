# AutoScout24 inventory upload with images

## Goal

Load scraped AutoScout24 inventory from `inventory-scraping/autoscaut24/` into Supabase: insert vehicle rows, upload local listing images to the `vehicles_images` bucket, and store public image URLs on each vehicle. Provide a separate script to delete all AutoScout24 rows first (DB only).

## Context

- JSON: `inventory-scraping/autoscaut24/autoscout24.json` (~3757 listings)
- Local images: `inventory-scraping/autoscaut24/images/autoscout24/{uuid}.jpg`
- Row `images` today are relative paths like `images/autoscout24/{uuid}.jpg`
- Existing upsert: `scripts/upload_autoscout24_inventory.ts` + `lib/inventory/upsert-vehicles-batch.ts`
- Existing delete helper: `lib/inventory/delete-source-vehicles.ts` (sources `autoscout24`, `autoscout24_at`)
- Existing bucket upload pattern: `scripts/upload_vehicle_images.ts` → bucket `vehicles_images`

Operator workflow: delete all AutoScout rows, then run a clean insert + image upload. Conflict/merge with existing AutoScout rows is not a primary concern.

## Approach

Two scripts (chosen over a single combined reset+load or a three-script split):

1. **Delete script** — remove all AutoScout24 vehicles from the DB
2. **Upload script** — upsert vehicles and upload/map images in one pass

## Delete script

**File:** `scripts/delete_autoscout24_inventory.ts`  
**npm:** `supabase:delete-autoscout24`

- Load `.env.local`; require service-role credentials (unless `--dry-run`)
- Call `deleteVehiclesBySources(["autoscout24", "autoscout24_at"])`
- `--dry-run`: report that it would delete those sources; do not mutate
- **No** `vehicles_images` bucket cleanup (out of scope; orphans acceptable for now)

## Upload script

**File:** extend `scripts/upload_autoscout24_inventory.ts`  
**npm:** existing `supabase:upload-autoscout24`

### Inputs / defaults

- JSON: `inventory-scraping/autoscaut24/autoscout24.json`
- Images root: `inventory-scraping/autoscaut24/`
- Flags: `--dry-run`, `--limit=N`, `--batch-size=N`, `--file=...`
- `--replace` optional escape hatch; **default off** (delete is separate)

### Per-vehicle flow

1. Normalize row via existing `prepareAutoscout24VehicleForUpload`
2. Resolve each relative image path under the Autoscout folder
3. Upload file to Storage bucket `vehicles_images` at `autoscout24/{uuid}{ext}`
4. Replace `payload.images` with public URL(s):  
   `{SUPABASE_URL}/storage/v1/object/public/vehicles_images/autoscout24/{uuid}{ext}`
5. Upsert vehicle row (so relative scrape paths never land in the DB)

### Shared helper

**File:** `lib/inventory/supabase-image-storage.ts`

- Upload file to `vehicles_images` with upsert
- Build public URL / encode storage path / MIME type
- Reuse patterns from `scripts/upload_vehicle_images.ts` without coupling to make/model folder matching

### Error handling

- Missing local file → warn, upsert vehicle with `images: []`, continue
- Single storage upload failure → warn, count failure, continue other vehicles
- Print summary: vehicles upserted, images uploaded, missing files, upload failures

### Dry-run

- Sample vehicle id / make / model
- Report how many local images would resolve vs missing
- No DB or storage writes

## Out of scope

- Bucket orphan cleanup after delete
- Willhaben image upload (same pattern can follow later)
- Embedding generation during upload

## Success criteria

- `npm run supabase:delete-autoscout24` removes all `autoscout24` / `autoscout24_at` vehicle rows
- `npm run supabase:upload-autoscout24` inserts vehicles with public `vehicles_images` URLs in `images`
- Missing images do not abort the full run
- `--dry-run` and `--limit` work for safe smoke tests
