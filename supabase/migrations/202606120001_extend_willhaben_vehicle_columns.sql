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
