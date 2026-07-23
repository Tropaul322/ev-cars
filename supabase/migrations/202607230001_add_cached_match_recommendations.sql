alter table public.match_sessions
  add column if not exists cached_recommendations jsonb not null default '[]'::jsonb;
