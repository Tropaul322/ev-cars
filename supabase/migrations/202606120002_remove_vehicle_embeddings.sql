drop function if exists public.match_vehicles_by_embedding(extensions.vector, integer, double precision);

drop index if exists public.vehicles_embedding_idx;

alter table public.vehicles
  drop column if exists embedding;
