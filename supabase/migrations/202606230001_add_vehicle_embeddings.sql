alter table public.vehicles
  add column if not exists embedding extensions.vector(1536),
  add column if not exists embedding_model text,
  add column if not exists embedding_dimensions integer,
  add column if not exists embedding_input_hash text,
  add column if not exists embedding_updated_at timestamptz;

create index if not exists vehicles_embedding_idx
  on public.vehicles
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;

create index if not exists vehicles_embedding_metadata_idx
  on public.vehicles (embedding_model, embedding_dimensions, embedding_input_hash)
  where embedding is not null;

create or replace function public.match_vehicles_by_embedding(
  query_embedding extensions.vector(1536),
  match_count integer default 80,
  min_similarity double precision default 0.1
)
returns table (
  id text,
  payload jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    vehicles.id,
    vehicles.payload,
    1 - (vehicles.embedding <=> query_embedding) as similarity
  from public.vehicles
  where vehicles.embedding is not null
    and vehicles.market = 'AT'
    and vehicles.available = true
    and 1 - (vehicles.embedding <=> query_embedding) >= min_similarity
  order by vehicles.embedding <=> query_embedding
  limit match_count;
$$;
