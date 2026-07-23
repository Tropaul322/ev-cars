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
      coalesce(filters -> 'hardBrandOriginCountryCodes', '[]'::jsonb) as hard_brand_origin_country_codes,
      nullif(filters ->> 'mileageMaxKm', '')::integer as mileage_max_km,
      nullif(filters ->> 'batterySoHMin', '')::numeric as battery_soh_min,
      nullif(filters ->> 'location', '') as location
  ),
  text_query as (
    select
      nullif(btrim(coalesce(query_text, '')), '') as q,
      case
        when nullif(btrim(coalesce(query_text, '')), '') is null then null
        else websearch_to_tsquery('simple', btrim(query_text))
      end as tsq
  ),
  text_candidates as (
    select
      vehicles.id,
      ts_rank_cd(vehicles.search_document, text_query.tsq) as text_rank,
      row_number() over (
        order by ts_rank_cd(vehicles.search_document, text_query.tsq) desc,
          vehicles.price_eur asc
      ) as text_rank_position
    from public.vehicles
    cross join filter_input f
    cross join text_query
    where text_query.tsq is not null
      and vehicles.search_document @@ text_query.tsq
      and vehicles.market = f.market
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
      and (
        f.mileage_max_km is null
        or (
          vehicles.mileage_km is not null
          and vehicles.mileage_km <= f.mileage_max_km
        )
        or (
          vehicles.condition is distinct from 'used'
          and vehicles.mileage_km is null
        )
      )
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
        or (
          jsonb_array_length(f.hard_brand_origin_country_codes) > 0
          and vehicles.manufacturer_country_code = any (
            select jsonb_array_elements_text(f.hard_brand_origin_country_codes)
          )
        )
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
            exists (
              select 1
              from unnest(string_to_array(coalesce(vehicles.features, ''), '|')) as tok(feature_name)
              where tok.feature_name = feature
            )
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
  vector_candidates as (
    select
      vehicles.id,
      1 - (vehicles.embedding <=> query_embedding) as semantic_similarity,
      row_number() over (
        order by vehicles.embedding <=> query_embedding,
          vehicles.price_eur asc
      ) as vector_rank_position
    from public.vehicles
    cross join filter_input f
    where query_embedding is not null
      and vehicles.embedding is not null
      and 1 - (vehicles.embedding <=> query_embedding) >= min_similarity
      and vehicles.market = f.market
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
      and (
        f.mileage_max_km is null
        or (
          vehicles.mileage_km is not null
          and vehicles.mileage_km <= f.mileage_max_km
        )
        or (
          vehicles.condition is distinct from 'used'
          and vehicles.mileage_km is null
        )
      )
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
        or (
          jsonb_array_length(f.hard_brand_origin_country_codes) > 0
          and vehicles.manufacturer_country_code = any (
            select jsonb_array_elements_text(f.hard_brand_origin_country_codes)
          )
        )
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
            exists (
              select 1
              from unnest(string_to_array(coalesce(vehicles.features, ''), '|')) as tok(feature_name)
              where tok.feature_name = feature
            )
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
  ranked_text as (
    select * from text_candidates
    where text_rank_position <= greatest(match_count * 4, 100)
  ),
  ranked_vector as (
    select * from vector_candidates
    where vector_rank_position <= greatest(match_count * 4, 100)
  ),
  candidate_ids as (
    select id from ranked_text
    union
    select id from ranked_vector
  ),
  fallback_ids as (
    select vehicles.id
    from public.vehicles
    cross join filter_input f
    cross join text_query
    where text_query.tsq is null
      and query_embedding is null
      and vehicles.market = f.market
      and vehicles.available = f.available
      and (f.budget_min_eur is null or vehicles.price_eur >= f.budget_min_eur)
      and (f.budget_max_eur is null or vehicles.price_eur <= f.budget_max_eur)
    order by vehicles.price_eur asc
    limit greatest(match_count, 1)
  ),
  fused as (
    select
      vehicles.id,
      vehicles.payload,
      vehicles.price_eur,
      ranked_vector.semantic_similarity,
      ranked_text.text_rank,
      coalesce(1.0 / (50 + ranked_text.text_rank_position), 0)
        + coalesce(1.0 / (50 + ranked_vector.vector_rank_position), 0) as rrf_score
    from public.vehicles
    left join ranked_text on ranked_text.id = vehicles.id
    left join ranked_vector on ranked_vector.id = vehicles.id
    where vehicles.id in (select id from candidate_ids)
       or vehicles.id in (select id from fallback_ids)
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
