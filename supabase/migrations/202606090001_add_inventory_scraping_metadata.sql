alter table public.vehicles
  add column if not exists dedupe_key text generated always as (payload ->> 'dedupeKey') stored,
  add column if not exists source_listing_id text generated always as (payload ->> 'sourceListingId') stored,
  add column if not exists listing_url text generated always as (payload ->> 'listingUrl') stored,
  add column if not exists manufacturer_country text generated always as (payload ->> 'manufacturerCountry') stored,
  add column if not exists manufacturer_country_code text generated always as (payload ->> 'manufacturerCountryCode') stored,
  add column if not exists seller_type text generated always as (payload ->> 'sellerType') stored,
  add column if not exists inventory_fingerprint text generated always as (payload ->> 'inventoryFingerprint') stored,
  add column if not exists crawled_at timestamptz generated always as (nullif(payload ->> 'crawledAt', '')::timestamptz) stored;

create unique index if not exists vehicles_dedupe_key_unique
  on public.vehicles (dedupe_key)
  where dedupe_key is not null;

create index if not exists vehicles_source_listing_id_idx on public.vehicles (source_listing_id);
create index if not exists vehicles_listing_url_idx on public.vehicles (listing_url);
create index if not exists vehicles_manufacturer_country_idx on public.vehicles (manufacturer_country);
create index if not exists vehicles_manufacturer_country_code_idx on public.vehicles (manufacturer_country_code);
create index if not exists vehicles_seller_type_idx on public.vehicles (seller_type);
create index if not exists vehicles_inventory_fingerprint_idx on public.vehicles (inventory_fingerprint);
create index if not exists vehicles_crawled_at_idx on public.vehicles (crawled_at);
