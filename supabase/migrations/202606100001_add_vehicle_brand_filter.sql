alter table public.vehicles
  add column if not exists brand text generated always as (coalesce(payload ->> 'brand', payload ->> 'make')) stored;

create index if not exists vehicles_brand_idx on public.vehicles (brand);
