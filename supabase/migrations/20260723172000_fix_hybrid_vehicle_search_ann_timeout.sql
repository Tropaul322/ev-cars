-- Fix hybrid search timeout: use IVFFlat ANN (ORDER BY <=> LIMIT) then hard-filter.
-- Previous plan seq-scanned ~11k embeddings with a window function (~10s), exceeding
-- anon (3s) / authenticator (8s) statement_timeout.

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
language plpgsql
stable
as $$
declare
  candidate_limit integer := least(greatest(match_count * 5, 400), 2000);
begin
  -- Improve IVFFlat recall while still using the index (default probes=1 under-fetches).
  perform set_config('ivfflat.probes', '10', true);

  return query
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
  -- Index-friendly ANN: no hard filters, no min_similarity, no secondary sort.
  vector_ann as (
    select
      ranked.id,
      ranked.semantic_similarity,
      ranked.vector_rank_position
    from (
      select
        v.id,
        (1 - (v.embedding <=> query_embedding))::double precision as semantic_similarity,
        row_number() over (order by v.embedding <=> query_embedding) as vector_rank_position
      from public.vehicles v
      where query_embedding is not null
        and v.embedding is not null
      order by v.embedding <=> query_embedding
      limit candidate_limit
    ) ranked
  ),
  -- GIN-friendly text retrieval with only market/available prefilters.
  text_hits as (
    select
      ranked.id,
      ranked.text_rank,
      ranked.text_rank_position
    from (
      select
        v.id,
        ts_rank_cd(v.search_document, tq.tsq) as text_rank,
        row_number() over (
          order by ts_rank_cd(v.search_document, tq.tsq) desc, v.price_eur asc
        ) as text_rank_position
      from public.vehicles v
      cross join text_query tq
      cross join filter_input f
      where tq.tsq is not null
        and v.search_document @@ tq.tsq
        and v.market = f.market
        and v.available = f.available
      order by ts_rank_cd(v.search_document, tq.tsq) desc, v.price_eur asc
      limit candidate_limit
    ) ranked
  ),
  ranked_vector as (
    select
      ann.id,
      ann.semantic_similarity,
      ann.vector_rank_position
    from vector_ann ann
    join public.vehicles v on v.id = ann.id
    cross join filter_input f
    where ann.semantic_similarity >= min_similarity
      and v.market = f.market
      and v.available = f.available
      and (f.budget_min_eur is null or v.price_eur >= f.budget_min_eur)
      and (f.budget_max_eur is null or v.price_eur <= f.budget_max_eur)
      and (
        f.monthly_budget_eur is null
        or v.monthly_lease_eur is null
        or v.monthly_lease_eur <= f.monthly_budget_eur
      )
      and (f.hard_range_floor_km is null or v.range_km >= f.hard_range_floor_km)
      and (f.hard_condition is null or v.condition = f.hard_condition)
      and (
        jsonb_array_length(f.hard_body_types) = 0
        or v.body_type = any (select jsonb_array_elements_text(f.hard_body_types))
      )
      and (f.hard_passengers is null or v.seats >= f.hard_passengers)
      and (
        f.mileage_max_km is null
        or (
          v.mileage_km is not null
          and v.mileage_km <= f.mileage_max_km
        )
        or (
          v.condition is distinct from 'used'
          and v.mileage_km is null
        )
      )
      and (f.battery_soh_min is null or v.battery_soh is null or v.battery_soh >= f.battery_soh_min)
      and (
        f.location is null
        or v.location ilike ('%' || f.location || '%')
      )
      and (
        jsonb_array_length(f.hard_brand_preferences) = 0
        or v.brand = any (select jsonb_array_elements_text(f.hard_brand_preferences))
        or v.make = any (select jsonb_array_elements_text(f.hard_brand_preferences))
      )
      and (
        jsonb_array_length(f.hard_brand_origins) = 0
        or v.brand_origin = any (select jsonb_array_elements_text(f.hard_brand_origins))
        or (
          jsonb_array_length(f.hard_brand_origin_country_codes) > 0
          and v.manufacturer_country_code = any (
            select jsonb_array_elements_text(f.hard_brand_origin_country_codes)
          )
        )
      )
      and (
        jsonb_array_length(f.avoided_brands) = 0
        or (
          coalesce(v.brand, '') <> all (select jsonb_array_elements_text(f.avoided_brands))
          and coalesce(v.make, '') <> all (select jsonb_array_elements_text(f.avoided_brands))
        )
      )
      and (
        jsonb_array_length(f.model_preferences) = 0
        or exists (
          select 1
          from jsonb_array_elements_text(f.model_preferences) as preferred(model)
          where v.model ilike ('%' || preferred.model || '%')
             or v.title ilike ('%' || preferred.model || '%')
        )
      )
      and (
        jsonb_array_length(f.must_have_features) = 0
        or (
          select bool_and(
            exists (
              select 1
              from unnest(string_to_array(coalesce(v.features, ''), '|')) as tok(feature_name)
              where tok.feature_name = feature
            )
            or exists (
              select 1
              from jsonb_array_elements_text(coalesce(v.payload -> 'features', '[]'::jsonb)) as listed(feature_name)
              where listed.feature_name = feature
            )
          )
          from jsonb_array_elements_text(f.must_have_features) as feature
        )
      )
  ),
  ranked_text as (
    select
      hits.id,
      hits.text_rank,
      hits.text_rank_position
    from text_hits hits
    join public.vehicles v on v.id = hits.id
    cross join filter_input f
    where (f.budget_min_eur is null or v.price_eur >= f.budget_min_eur)
      and (f.budget_max_eur is null or v.price_eur <= f.budget_max_eur)
      and (
        f.monthly_budget_eur is null
        or v.monthly_lease_eur is null
        or v.monthly_lease_eur <= f.monthly_budget_eur
      )
      and (f.hard_range_floor_km is null or v.range_km >= f.hard_range_floor_km)
      and (f.hard_condition is null or v.condition = f.hard_condition)
      and (
        jsonb_array_length(f.hard_body_types) = 0
        or v.body_type = any (select jsonb_array_elements_text(f.hard_body_types))
      )
      and (f.hard_passengers is null or v.seats >= f.hard_passengers)
      and (
        f.mileage_max_km is null
        or (
          v.mileage_km is not null
          and v.mileage_km <= f.mileage_max_km
        )
        or (
          v.condition is distinct from 'used'
          and v.mileage_km is null
        )
      )
      and (f.battery_soh_min is null or v.battery_soh is null or v.battery_soh >= f.battery_soh_min)
      and (
        f.location is null
        or v.location ilike ('%' || f.location || '%')
      )
      and (
        jsonb_array_length(f.hard_brand_preferences) = 0
        or v.brand = any (select jsonb_array_elements_text(f.hard_brand_preferences))
        or v.make = any (select jsonb_array_elements_text(f.hard_brand_preferences))
      )
      and (
        jsonb_array_length(f.hard_brand_origins) = 0
        or v.brand_origin = any (select jsonb_array_elements_text(f.hard_brand_origins))
        or (
          jsonb_array_length(f.hard_brand_origin_country_codes) > 0
          and v.manufacturer_country_code = any (
            select jsonb_array_elements_text(f.hard_brand_origin_country_codes)
          )
        )
      )
      and (
        jsonb_array_length(f.avoided_brands) = 0
        or (
          coalesce(v.brand, '') <> all (select jsonb_array_elements_text(f.avoided_brands))
          and coalesce(v.make, '') <> all (select jsonb_array_elements_text(f.avoided_brands))
        )
      )
      and (
        jsonb_array_length(f.model_preferences) = 0
        or exists (
          select 1
          from jsonb_array_elements_text(f.model_preferences) as preferred(model)
          where v.model ilike ('%' || preferred.model || '%')
             or v.title ilike ('%' || preferred.model || '%')
        )
      )
      and (
        jsonb_array_length(f.must_have_features) = 0
        or (
          select bool_and(
            exists (
              select 1
              from unnest(string_to_array(coalesce(v.features, ''), '|')) as tok(feature_name)
              where tok.feature_name = feature
            )
            or exists (
              select 1
              from jsonb_array_elements_text(coalesce(v.payload -> 'features', '[]'::jsonb)) as listed(feature_name)
              where listed.feature_name = feature
            )
          )
          from jsonb_array_elements_text(f.must_have_features) as feature
        )
      )
  ),
  candidate_ids as (
    select ranked_text.id from ranked_text
    union
    select ranked_vector.id from ranked_vector
  ),
  fallback_ids as (
    select v.id
    from public.vehicles v
    cross join filter_input f
    cross join text_query tq
    where tq.tsq is null
      and query_embedding is null
      and v.market = f.market
      and v.available = f.available
      and (f.budget_min_eur is null or v.price_eur >= f.budget_min_eur)
      and (f.budget_max_eur is null or v.price_eur <= f.budget_max_eur)
    order by v.price_eur asc
    limit greatest(match_count, 1)
  ),
  fused as (
    select
      v.id,
      v.payload,
      v.price_eur,
      ranked_vector.semantic_similarity,
      ranked_text.text_rank,
      (
        coalesce(1.0 / (50 + ranked_text.text_rank_position), 0)
        + coalesce(1.0 / (50 + ranked_vector.vector_rank_position), 0)
      )::double precision as rrf_score
    from public.vehicles v
    left join ranked_text on ranked_text.id = v.id
    left join ranked_vector on ranked_vector.id = v.id
    where v.id in (select candidate_ids.id from candidate_ids)
       or v.id in (select fallback_ids.id from fallback_ids)
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
end;
$$;
