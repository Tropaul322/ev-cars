-- Widen vehicles.search_document so hybrid FTS can match style/capacity tokens.
-- Drop + recreate generated column (Postgres cannot ALTER generated expression in place).
-- Note: use || instead of concat_ws — concat_ws is STABLE and cannot appear in generated columns.

set local maintenance_work_mem = '128MB';

drop index if exists public.vehicles_search_document_idx;

alter table public.vehicles
  drop column if exists search_document;

alter table public.vehicles
  add column search_document tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(brand, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(make, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(model, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(trim, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body_type, '')), 'B') ||
    setweight(
      to_tsvector(
        'simple',
        trim(
          both ' ' from (
            (case when seats is not null then seats::text || ' seats' else '' end) || ' ' ||
            (case when seats is not null then seats::text || ' sitze' else '' end) || ' ' ||
            (case when seats is not null and seats <= 2 then '2-seater two seater zweisitzer 2 sitzer' else '' end) || ' ' ||
            (case when seats is not null and seats >= 5 then 'family seats familienauto' else '' end) || ' ' ||
            (case
              when body_type = 'suv' then 'suv geländewagen gelaendewagen'
              when body_type = 'sedan' then 'sedan limousine'
              when body_type = 'hatchback' then 'hatchback schrägheck schraegheck'
              when body_type = 'compact' then 'compact kleinwagen'
              when body_type = 'wagon' then 'wagon kombi'
              when body_type = 'crossover' then 'crossover suv'
              when body_type = 'van' then 'van kleinbus'
              when body_type = 'minibus' then 'minibus'
              else coalesce(body_type, '')
            end)
          )
        )
      ),
      'B'
    ) ||
    setweight(to_tsvector('simple', coalesce(drivetrain, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(location, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(review_tags, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(notes, '')), 'C')
  ) stored;

create index if not exists vehicles_search_document_idx
  on public.vehicles using gin (search_document);
