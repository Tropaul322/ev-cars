set maintenance_work_mem = '128MB';

alter table public.vehicles
  add column if not exists monthly_lease_eur integer generated always as (round(nullif(payload ->> 'monthlyLeaseEUR', '')::numeric)::integer) stored,
  add column if not exists seats integer generated always as (nullif(payload ->> 'seats', '')::integer) stored;

create index if not exists vehicles_price_eur_idx on public.vehicles (price_eur);
create index if not exists vehicles_condition_idx on public.vehicles (condition);
create index if not exists vehicles_monthly_lease_eur_idx on public.vehicles (monthly_lease_eur);
create index if not exists vehicles_seats_idx on public.vehicles (seats);
