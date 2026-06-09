create extension if not exists vector with schema extensions;

alter table public.vehicles
  add column if not exists available boolean generated always as (coalesce((payload ->> 'available')::boolean, false)) stored,
  add column if not exists mileage_km integer generated always as (nullif(payload ->> 'mileageKm', '')::integer) stored,
  add column if not exists range_km integer generated always as (nullif(payload ->> 'rangeKm', '')::integer) stored,
  add column if not exists battery_soh numeric generated always as (nullif(payload ->> 'batterySoH', '')::numeric) stored,
  add column if not exists body_type text generated always as (payload ->> 'bodyType') stored,
  add column if not exists location text generated always as (payload ->> 'location') stored;

create index if not exists vehicles_available_idx on public.vehicles (available);
create index if not exists vehicles_range_km_idx on public.vehicles (range_km);
create index if not exists vehicles_mileage_km_idx on public.vehicles (mileage_km);
create index if not exists vehicles_battery_soh_idx on public.vehicles (battery_soh);
create index if not exists vehicles_body_type_idx on public.vehicles (body_type);
create index if not exists vehicles_location_idx on public.vehicles (location);

create table if not exists public.knowledge_chunks (
  id text primary key,
  document_id text references public.knowledge_documents(id) on delete cascade,
  topic text not null check (topic in ('review', 'technical_spec', 'austrian_incentive', 'charging_network', 'general')),
  source text not null,
  language text not null check (language in ('de', 'en')),
  heading text not null,
  content text not null,
  content_hash text not null,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_topic_idx on public.knowledge_chunks (topic);
create index if not exists knowledge_chunks_source_idx on public.knowledge_chunks (source);
create index if not exists knowledge_chunks_language_idx on public.knowledge_chunks (language);
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;

drop trigger if exists knowledge_chunks_touch_updated_at on public.knowledge_chunks;

create trigger knowledge_chunks_touch_updated_at
before update on public.knowledge_chunks
for each row
execute function public.touch_updated_at();

create or replace function public.match_knowledge_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  min_similarity double precision default 0
)
returns table (
  id text,
  document_id text,
  topic text,
  source text,
  language text,
  heading text,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    knowledge_chunks.id,
    knowledge_chunks.document_id,
    knowledge_chunks.topic,
    knowledge_chunks.source,
    knowledge_chunks.language,
    knowledge_chunks.heading,
    knowledge_chunks.content,
    knowledge_chunks.metadata,
    1 - (knowledge_chunks.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks
  where knowledge_chunks.embedding is not null
    and 1 - (knowledge_chunks.embedding <=> query_embedding) >= min_similarity
  order by knowledge_chunks.embedding <=> query_embedding
  limit match_count;
$$;
