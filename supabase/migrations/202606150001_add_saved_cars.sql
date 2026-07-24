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
