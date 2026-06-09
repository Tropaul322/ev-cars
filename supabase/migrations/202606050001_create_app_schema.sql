create table if not exists public.vehicles (
  id text primary key,
  payload jsonb not null,
  source text generated always as (payload ->> 'source') stored,
  make text generated always as (payload ->> 'make') stored,
  model text generated always as (payload ->> 'model') stored,
  title text generated always as (payload ->> 'title') stored,
  condition text generated always as (payload ->> 'condition') stored,
  price_eur integer generated always as (((payload ->> 'priceEUR')::integer)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicles_payload_make_idx
  on public.vehicles ((payload ->> 'make'));

create index if not exists vehicles_payload_condition_idx
  on public.vehicles ((payload ->> 'condition'));

create index if not exists vehicles_source_idx
  on public.vehicles (source);

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
