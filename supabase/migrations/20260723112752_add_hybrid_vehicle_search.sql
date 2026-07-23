alter table public.vehicles
  add column if not exists search_document tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(brand, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(make, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(model, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(trim, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(title, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(notes, '')), 'C')
  ) stored;

create index if not exists vehicles_search_document_idx
  on public.vehicles using gin (search_document);

create index if not exists vehicles_active_at_price_range_idx
  on public.vehicles (price_eur, range_km)
  where market = 'AT' and available = true;

create or replace function public.search_vehicles_hybrid(
  query_text text default '',
  query_embedding extensions.vector(1536) default null,
  filters jsonb default '{}'::jsonb,
  match_count integer default 80,
  min_similarity double precision default 0.1
)
returns table (
  id text,
  payload jsonb,
  semantic_similarity double precision,
  text_rank real,
  rrf_score double precision
)
language sql
stable
as $$
  with filter_input as (
    select
      coalesce(filters ->> 'market', 'AT') as market,
      coalesce((filters ->> 'available')::boolean, true) as available,
      nullif(filters ->> 'budgetMinEUR', '')::integer as budget_min_eur,
      nullif(filters ->> 'budgetMaxEUR', '')::integer as budget_max_eur,
      nullif(filters ->> 'monthlyBudgetEUR', '')::integer as monthly_budget_eur,
      coalesce(filters -> 'modelPreferences', '[]'::jsonb) as model_preferences,
      coalesce(filters -> 'avoidedBrands', '[]'::jsonb) as avoided_brands,
      coalesce(filters -> 'mustHaveFeatures', '[]'::jsonb) as must_have_features,
      nullif(filters ->> 'hardRangeFloorKm', '')::integer as hard_range_floor_km,
      coalesce(filters -> 'hardBodyTypes', '[]'::jsonb) as hard_body_types,
      nullif(filters ->> 'hardPassengers', '')::integer as hard_passengers,
      nullif(filters ->> 'hardCondition', '') as hard_condition,
      coalesce(filters -> 'hardBrandPreferences', '[]'::jsonb) as hard_brand_preferences,
      coalesce(filters -> 'hardBrandOrigins', '[]'::jsonb) as hard_brand_origins,
      nullif(filters ->> 'mileageMaxKm', '')::integer as mileage_max_km,
      nullif(filters ->> 'batterySoHMin', '')::numeric as battery_soh_min,
      nullif(filters ->> 'location', '') as location
  ),
  eligible as (
    select vehicles.*
    from public.vehicles
    cross join filter_input f
    where vehicles.market = f.market
      and vehicles.available = f.available
      and (f.budget_min_eur is null or vehicles.price_eur >= f.budget_min_eur)
      and (f.budget_max_eur is null or vehicles.price_eur <= f.budget_max_eur)
      and (
        f.monthly_budget_eur is null
        or vehicles.monthly_lease_eur is null
        or vehicles.monthly_lease_eur <= f.monthly_budget_eur
      )
      and (f.hard_range_floor_km is null or vehicles.range_km >= f.hard_range_floor_km)
      and (f.hard_condition is null or vehicles.condition = f.hard_condition)
      and (
        jsonb_array_length(f.hard_body_types) = 0
        or vehicles.body_type = any (select jsonb_array_elements_text(f.hard_body_types))
      )
      and (f.hard_passengers is null or vehicles.seats >= f.hard_passengers)
      and (f.mileage_max_km is null or vehicles.mileage_km is null or vehicles.mileage_km <= f.mileage_max_km)
      and (f.battery_soh_min is null or vehicles.battery_soh is null or vehicles.battery_soh >= f.battery_soh_min)
      and (
        f.location is null
        or vehicles.location ilike ('%' || f.location || '%')
      )
      and (
        jsonb_array_length(f.hard_brand_preferences) = 0
        or vehicles.brand = any (select jsonb_array_elements_text(f.hard_brand_preferences))
        or vehicles.make = any (select jsonb_array_elements_text(f.hard_brand_preferences))
      )
      and (
        jsonb_array_length(f.hard_brand_origins) = 0
        or vehicles.brand_origin = any (select jsonb_array_elements_text(f.hard_brand_origins))
      )
      and (
        jsonb_array_length(f.avoided_brands) = 0
        or (
          coalesce(vehicles.brand, '') <> all (select jsonb_array_elements_text(f.avoided_brands))
          and coalesce(vehicles.make, '') <> all (select jsonb_array_elements_text(f.avoided_brands))
        )
      )
      and (
        jsonb_array_length(f.model_preferences) = 0
        or exists (
          select 1
          from jsonb_array_elements_text(f.model_preferences) as preferred(model)
          where vehicles.model ilike ('%' || preferred.model || '%')
             or vehicles.title ilike ('%' || preferred.model || '%')
        )
      )
      and (
        jsonb_array_length(f.must_have_features) = 0
        or (
          select bool_and(
            position(feature in coalesce(vehicles.features, '')) > 0
            or exists (
              select 1
              from jsonb_array_elements_text(coalesce(vehicles.payload -> 'features', '[]'::jsonb)) as listed(feature_name)
              where listed.feature_name = feature
            )
          )
          from jsonb_array_elements_text(f.must_have_features) as feature
        )
      )
  ),
  text_query as (
    select nullif(btrim(coalesce(query_text, '')), '') as q
  ),
  text_candidates as (
    select
      eligible.id,
      ts_rank_cd(eligible.search_document, websearch_to_tsquery('simple', text_query.q)) as text_rank,
      row_number() over (
        order by ts_rank_cd(eligible.search_document, websearch_to_tsquery('simple', text_query.q)) desc,
          eligible.price_eur asc
      ) as text_rank_position
    from eligible
    cross join text_query
    where text_query.q is not null
      and eligible.search_document @@ websearch_to_tsquery('simple', text_query.q)
  ),
  vector_candidates as (
    select
      eligible.id,
      1 - (eligible.embedding <=> query_embedding) as semantic_similarity,
      row_number() over (
        order by eligible.embedding <=> query_embedding,
          eligible.price_eur asc
      ) as vector_rank_position
    from eligible
    where query_embedding is not null
      and eligible.embedding is not null
      and 1 - (eligible.embedding <=> query_embedding) >= min_similarity
  ),
  fused as (
    select
      eligible.id,
      eligible.payload,
      eligible.price_eur,
      vector_candidates.semantic_similarity,
      text_candidates.text_rank,
      coalesce(1.0 / (50 + text_candidates.text_rank_position), 0)
        + coalesce(1.0 / (50 + vector_candidates.vector_rank_position), 0) as rrf_score
    from eligible
    left join text_candidates on text_candidates.id = eligible.id
    left join vector_candidates on vector_candidates.id = eligible.id
  )
  select
    fused.id,
    fused.payload,
    fused.semantic_similarity,
    fused.text_rank,
    fused.rrf_score
  from fused
  order by fused.rrf_score desc, fused.price_eur asc
  limit greatest(match_count, 1);
$$;
