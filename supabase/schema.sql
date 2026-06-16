create table if not exists public.vehicles (
  id text primary key,
  payload jsonb not null,
  source text generated always as (payload ->> 'source') stored,
  brand text generated always as (coalesce(payload ->> 'brand', payload ->> 'make')) stored,
  make text generated always as (payload ->> 'make') stored,
  model text generated always as (payload ->> 'model') stored,
  title text generated always as (payload ->> 'title') stored,
  condition text generated always as (payload ->> 'condition') stored,
  price_eur integer generated always as (((payload ->> 'priceEUR')::integer)) stored,
  monthly_lease_eur integer generated always as (nullif(payload ->> 'monthlyLeaseEUR', '')::integer) stored,
  available boolean generated always as (coalesce((payload ->> 'available')::boolean, false)) stored,
  mileage_km integer generated always as (nullif(payload ->> 'mileageKm', '')::integer) stored,
  range_km integer generated always as (nullif(payload ->> 'rangeKm', '')::integer) stored,
  battery_soh numeric generated always as (nullif(payload ->> 'batterySoH', '')::numeric) stored,
  body_type text generated always as (payload ->> 'bodyType') stored,
  seats integer generated always as (nullif(payload ->> 'seats', '')::integer) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicles_payload_make_idx
  on public.vehicles ((payload ->> 'make'));

create index if not exists vehicles_brand_idx
  on public.vehicles (brand);

create index if not exists vehicles_price_eur_idx
  on public.vehicles (price_eur);

create index if not exists vehicles_monthly_lease_eur_idx
  on public.vehicles (monthly_lease_eur);

create index if not exists vehicles_available_idx
  on public.vehicles (available);

create index if not exists vehicles_range_km_idx
  on public.vehicles (range_km);

create index if not exists vehicles_mileage_km_idx
  on public.vehicles (mileage_km);

create index if not exists vehicles_battery_soh_idx
  on public.vehicles (battery_soh);

create index if not exists vehicles_body_type_idx
  on public.vehicles (body_type);

create index if not exists vehicles_seats_idx
  on public.vehicles (seats);

create index if not exists vehicles_condition_idx
  on public.vehicles (condition);

create index if not exists vehicles_payload_condition_idx
  on public.vehicles ((payload ->> 'condition'));

create index if not exists vehicles_source_idx
  on public.vehicles (source);

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

alter table public.vehicles
  add column if not exists market text generated always as (payload ->> 'market') stored,
  add column if not exists year integer generated always as (nullif(payload ->> 'year', '')::integer) stored,
  add column if not exists location text generated always as (payload ->> 'location') stored,
  add column if not exists transmission text generated always as (payload ->> 'transmission') stored,
  add column if not exists exterior_color text generated always as (payload ->> 'exteriorColor') stored,
  add column if not exists doors integer generated always as (nullif(payload ->> 'doors', '')::integer) stored,
  add column if not exists leasing_eligible boolean generated always as ((payload ->> 'leasingEligible')::boolean) stored,
  add column if not exists lease_duration_months integer generated always as (nullif(payload ->> 'leaseDurationMonths', '')::integer) stored,
  add column if not exists source_updated_at timestamptz generated always as (nullif(payload ->> 'sourceUpdatedAt', '')::timestamptz) stored,
  add column if not exists vat_deductible boolean generated always as ((payload ->> 'vatDeductible')::boolean) stored,
  add column if not exists brand_origin text generated always as (payload ->> 'brandOrigin') stored,
  add column if not exists power_kw numeric generated always as (nullif(payload ->> 'powerKw', '')::numeric) stored;

create index if not exists vehicles_market_idx on public.vehicles (market);
create index if not exists vehicles_year_idx on public.vehicles (year);
create index if not exists vehicles_location_idx on public.vehicles (location);
create index if not exists vehicles_transmission_idx on public.vehicles (transmission);
create index if not exists vehicles_exterior_color_idx on public.vehicles (exterior_color);
create index if not exists vehicles_leasing_eligible_idx on public.vehicles (leasing_eligible);
create index if not exists vehicles_brand_origin_idx on public.vehicles (brand_origin);
create index if not exists vehicles_source_updated_at_idx on public.vehicles (source_updated_at);

create table if not exists public.knowledge_documents (
  id text primary key,
  source text not null,
  heading text not null,
  content text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_documents_source_idx
  on public.knowledge_documents (source);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vehicles_touch_updated_at on public.vehicles;

create trigger vehicles_touch_updated_at
before update on public.vehicles
for each row
execute function public.touch_updated_at();

drop trigger if exists knowledge_documents_touch_updated_at on public.knowledge_documents;

create trigger knowledge_documents_touch_updated_at
before update on public.knowledge_documents
for each row
execute function public.touch_updated_at();

create table if not exists public.match_sessions (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('de', 'en')),
  criteria jsonb not null,
  selected_vehicle_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.tester_registrations (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  location text,
  consent_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.saved_cars (
  id uuid primary key default gen_random_uuid(),
  tester_registration_id uuid not null references public.tester_registrations(id) on delete cascade,
  vehicle_id text not null,
  snapshot jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tester_registration_id, vehicle_id)
);

create index if not exists saved_cars_tester_active_idx
  on public.saved_cars (tester_registration_id, updated_at desc)
  where deleted_at is null;

create index if not exists saved_cars_vehicle_idx
  on public.saved_cars (vehicle_id);

drop trigger if exists saved_cars_touch_updated_at on public.saved_cars;

create trigger saved_cars_touch_updated_at
before update on public.saved_cars
for each row
execute function public.touch_updated_at();
