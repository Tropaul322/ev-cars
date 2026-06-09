alter table public.vehicles
  add column if not exists embedding extensions.vector(1536);

create index if not exists vehicles_embedding_idx
  on public.vehicles
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 100)
  where embedding is not null;

create or replace function public.match_vehicles_by_embedding(
  query_embedding extensions.vector(1536),
  match_count integer default 30,
  min_similarity double precision default 0
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
    and coalesce((vehicles.payload ->> 'available')::boolean, false) = true
    and 1 - (vehicles.embedding <=> query_embedding) >= min_similarity
  order by vehicles.embedding <=> query_embedding
  limit match_count;
$$;
