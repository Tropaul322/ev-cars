create table if not exists public.vehicles (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  source text,
  brand text,
  make text,
  model text,
  trim text,
  title text,
  condition text,
  price_eur integer,
  monthly_lease_eur integer,
  available boolean default false,
  mileage_km integer,
  range_km integer,
  efficiency_kwh_per_100_km numeric,
  battery_kwh numeric,
  battery_soh numeric,
  body_type text,
  seats integer,
  cargo_liters integer,
  drivetrain text,
  power_kw numeric,
  features text,
  images text,
  notes text,
  review_tags text,
  dedupe_key text,
  source_listing_id text,
  listing_url text,
  manufacturer_country text,
  manufacturer_country_code text,
  seller_type text,
  inventory_fingerprint text,
  crawled_at timestamptz,
  market text,
  year integer,
  location text,
  transmission text,
  exterior_color text,
  doors integer,
  leasing_eligible boolean,
  lease_duration_months integer,
  source_updated_at timestamptz,
  vat_deductible boolean,
  brand_origin text,
  embedding extensions.vector(1536),
  embedding_model text,
  embedding_dimensions integer,
  embedding_input_hash text,
  embedding_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicles_payload_make_idx
  on public.vehicles ((payload ->> 'make'));

create index if not exists vehicles_brand_idx
  on public.vehicles (brand);

create index if not exists vehicles_price_eur_idx
  on public.vehicles (price_eur);

create index if not exists vehicles_monthly_lease_eur_idx
  on public.vehicles (monthly_lease_eur);

create index if not exists vehicles_available_idx
  on public.vehicles (available);

create index if not exists vehicles_range_km_idx
  on public.vehicles (range_km);

create index if not exists vehicles_mileage_km_idx
  on public.vehicles (mileage_km);

create index if not exists vehicles_battery_soh_idx
  on public.vehicles (battery_soh);

create index if not exists vehicles_body_type_idx
  on public.vehicles (body_type);

create index if not exists vehicles_seats_idx
  on public.vehicles (seats);

create index if not exists vehicles_condition_idx
  on public.vehicles (condition);

create index if not exists vehicles_payload_condition_idx
  on public.vehicles ((payload ->> 'condition'));

create index if not exists vehicles_source_idx
  on public.vehicles (source);

create unique index if not exists vehicles_dedupe_key_unique
  on public.vehicles (dedupe_key)
  where dedupe_key is not null;

create index if not exists vehicles_source_listing_id_idx on public.vehicles (source_listing_id);
create index if not exists vehicles_listing_url_idx on public.vehicles (listing_url);
create index if not exists vehicles_manufacturer_country_idx on public.vehicles (manufacturer_country);
create index if not exists vehicles_manufacturer_country_code_idx on public.vehicles (manufacturer_country_code);
create index if not exists vehicles_seller_type_idx on public.vehicles (seller_type);
create index if not exists vehicles_inventory_fingerprint_idx on public.vehicles (inventory_fingerprint);
create index if not exists vehicles_crawled_at_idx on public.vehicles (crawled_at);

create index if not exists vehicles_market_idx on public.vehicles (market);
create index if not exists vehicles_year_idx on public.vehicles (year);
create index if not exists vehicles_location_idx on public.vehicles (location);
create index if not exists vehicles_transmission_idx on public.vehicles (transmission);
create index if not exists vehicles_exterior_color_idx on public.vehicles (exterior_color);
create index if not exists vehicles_leasing_eligible_idx on public.vehicles (leasing_eligible);
create index if not exists vehicles_brand_origin_idx on public.vehicles (brand_origin);
create index if not exists vehicles_source_updated_at_idx on public.vehicles (source_updated_at);
create index if not exists vehicles_trim_idx on public.vehicles (trim);
create index if not exists vehicles_battery_kwh_idx on public.vehicles (battery_kwh);
create index if not exists vehicles_drivetrain_idx on public.vehicles (drivetrain);
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

create or replace function public.vehicles_pipe_text_to_json_array(value text)
returns jsonb
language sql
immutable
as $$
  select case
    when value is null or btrim(value) = '' then '[]'::jsonb
    else coalesce(
      (
        select jsonb_agg(btrim(item))
        from unnest(string_to_array(value, '|')) as t(item)
        where btrim(item) <> ''
      ),
      '[]'::jsonb
    )
  end;
$$;

create or replace function public.vehicles_json_array_to_pipe_text(value jsonb)
returns text
language sql
immutable
as $$
  select nullif(
    (
      select string_agg(item, '|' order by ordinality)
      from jsonb_array_elements_text(coalesce(value, '[]'::jsonb)) with ordinality as t(item, ordinality)
    ),
    ''
  );
$$;

create or replace function public.vehicles_safe_int(value text)
returns integer
language sql
immutable
as $$
  select case
    when value is null or btrim(value) = '' then null
    else round(value::numeric)::integer
  end;
$$;

create or replace function public.vehicles_safe_numeric(value text)
returns numeric
language sql
immutable
as $$
  select case
    when value is null or btrim(value) = '' then null
    else value::numeric
  end;
$$;

create or replace function public.vehicles_build_payload_from_columns(v public.vehicles)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
  warranty_text text;
  title_text text;
begin
  warranty_text := case
    when v.condition = 'new' then 'New listing; verify factory and battery warranty with seller.'
    else 'Used listing; verify remaining battery warranty and battery state-of-health with seller.'
  end;

  title_text := coalesce(
    nullif(btrim(v.title), ''),
    nullif(btrim(concat_ws(' ', v.make, v.model, v.trim)), ''),
    v.id
  );

  result := jsonb_strip_nulls(
    jsonb_build_object(
      'id', v.id,
      'source', coalesce(nullif(btrim(v.source), ''), 'seed'),
      'market', coalesce(nullif(btrim(v.market), ''), 'AT'),
      'make', v.make,
      'model', v.model,
      'trim', v.trim,
      'year', v.year,
      'condition', v.condition,
      'priceEUR', v.price_eur,
      'monthlyLeaseEUR', v.monthly_lease_eur,
      'mileageKm', v.mileage_km,
      'rangeKm', v.range_km,
      'efficiencyKwhPer100Km', v.efficiency_kwh_per_100_km,
      'batteryKwh', v.battery_kwh,
      'batterySoH', v.battery_soh,
      'bodyType', v.body_type,
      'seats', v.seats,
      'cargoLiters', v.cargo_liters,
      'drivetrain', v.drivetrain,
      'powerKw', v.power_kw,
      'available', coalesce(v.available, true),
      'location', v.location,
      'listingUrl', v.listing_url,
      'title', title_text,
      'notes', coalesce(nullif(btrim(v.notes), ''), 'Imported from spreadsheet.'),
      'brandOrigin', coalesce(nullif(btrim(v.brand_origin), ''), 'other'),
      'dedupeKey', coalesce(nullif(btrim(v.dedupe_key), ''), v.id),
      'sourceListingId', v.source_listing_id,
      'leasingEligible', v.leasing_eligible,
      'leaseDurationMonths', v.lease_duration_months,
      'exteriorColor', v.exterior_color,
      'transmission', v.transmission,
      'doors', v.doors,
      'vatDeductible', v.vat_deductible,
      'sellerType', v.seller_type,
      'manufacturerCountry', v.manufacturer_country,
      'manufacturerCountryCode', v.manufacturer_country_code,
      'inventoryFingerprint', v.inventory_fingerprint,
      'crawledAt', v.crawled_at,
      'sourceUpdatedAt', v.source_updated_at,
      'warranty', warranty_text,
      'chargingCycles', null
    )
  );

  result := result || jsonb_build_object(
    'features', public.vehicles_pipe_text_to_json_array(v.features),
    'images', public.vehicles_pipe_text_to_json_array(v.images),
    'reviewTags', coalesce(
      public.vehicles_pipe_text_to_json_array(v.review_tags),
      '["imported"]'::jsonb
    )
  );

  if coalesce(jsonb_array_length(result -> 'reviewTags'), 0) = 0 then
    result := result || jsonb_build_object('reviewTags', jsonb_build_array('imported'));
  end if;

  return result;
end;
$$;

create or replace function public.vehicles_set_columns_from_payload(v public.vehicles)
returns public.vehicles
language plpgsql
as $$
declare
  p jsonb := v.payload;
begin
  v.source := p ->> 'source';
  v.brand := coalesce(p ->> 'brand', p ->> 'make');
  v.make := p ->> 'make';
  v.model := p ->> 'model';
  v.trim := p ->> 'trim';
  v.title := p ->> 'title';
  v.condition := p ->> 'condition';
  v.price_eur := public.vehicles_safe_int(p ->> 'priceEUR');
  v.monthly_lease_eur := public.vehicles_safe_int(p ->> 'monthlyLeaseEUR');
  v.available := coalesce((p ->> 'available')::boolean, false);
  v.mileage_km := public.vehicles_safe_int(p ->> 'mileageKm');
  v.range_km := public.vehicles_safe_int(p ->> 'rangeKm');
  v.battery_soh := public.vehicles_safe_numeric(p ->> 'batterySoH');
  v.body_type := p ->> 'bodyType';
  v.seats := public.vehicles_safe_int(p ->> 'seats');
  v.dedupe_key := p ->> 'dedupeKey';
  v.source_listing_id := p ->> 'sourceListingId';
  v.listing_url := p ->> 'listingUrl';
  v.manufacturer_country := p ->> 'manufacturerCountry';
  v.manufacturer_country_code := p ->> 'manufacturerCountryCode';
  v.seller_type := p ->> 'sellerType';
  v.inventory_fingerprint := p ->> 'inventoryFingerprint';
  v.crawled_at := nullif(p ->> 'crawledAt', '')::timestamptz;
  v.market := p ->> 'market';
  v.year := public.vehicles_safe_int(p ->> 'year');
  v.location := p ->> 'location';
  v.transmission := p ->> 'transmission';
  v.exterior_color := p ->> 'exteriorColor';
  v.doors := public.vehicles_safe_int(p ->> 'doors');
  v.leasing_eligible := nullif(p ->> 'leasingEligible', '')::boolean;
  v.lease_duration_months := public.vehicles_safe_int(p ->> 'leaseDurationMonths');
  v.source_updated_at := nullif(p ->> 'sourceUpdatedAt', '')::timestamptz;
  v.vat_deductible := nullif(p ->> 'vatDeductible', '')::boolean;
  v.brand_origin := p ->> 'brandOrigin';
  v.power_kw := public.vehicles_safe_numeric(p ->> 'powerKw');
  v.efficiency_kwh_per_100_km := public.vehicles_safe_numeric(p ->> 'efficiencyKwhPer100Km');
  v.battery_kwh := public.vehicles_safe_numeric(p ->> 'batteryKwh');
  v.cargo_liters := public.vehicles_safe_int(p ->> 'cargoLiters');
  v.drivetrain := p ->> 'drivetrain';
  v.notes := p ->> 'notes';
  v.features := public.vehicles_json_array_to_pipe_text(p -> 'features');
  v.images := public.vehicles_json_array_to_pipe_text(p -> 'images');
  v.review_tags := public.vehicles_json_array_to_pipe_text(p -> 'reviewTags');

  return v;
end;
$$;

create or replace function public.vehicles_sync_sheet_row()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.payload is not null and new.payload <> '{}'::jsonb then
      new := public.vehicles_set_columns_from_payload(new);
    else
      if new.available is false then
        new.available := null;
      end if;
      new.payload := public.vehicles_build_payload_from_columns(new);
      new := public.vehicles_set_columns_from_payload(new);
    end if;
  elsif new.payload is distinct from old.payload then
    new := public.vehicles_set_columns_from_payload(new);
  else
    new.payload := public.vehicles_build_payload_from_columns(new);
    new := public.vehicles_set_columns_from_payload(new);
  end if;

  if new.payload is null or new.payload = '{}'::jsonb then
    raise exception 'vehicles row requires payload or sheet columns (id=%)', new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists vehicles_sync_sheet_row on public.vehicles;

create trigger vehicles_sync_sheet_row
before insert or update on public.vehicles
for each row
execute function public.vehicles_sync_sheet_row();

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

create table if not exists public.tester_registrations (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  location text,
  consent_at timestamptz,
  deletion_requested_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.match_sessions (
  id uuid primary key default gen_random_uuid(),
  tester_registration_id uuid references public.tester_registrations(id) on delete cascade,
  language text not null check (language in ('de', 'en')),
  criteria jsonb not null,
  selected_vehicle_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists match_sessions_tester_idx
  on public.match_sessions (tester_registration_id, created_at desc);

create table if not exists public.saved_cars (
  id uuid primary key default gen_random_uuid(),
  tester_registration_id uuid not null references public.tester_registrations(id) on delete cascade,
  vehicle_id text not null,
  snapshot jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tester_registration_id, vehicle_id)
);

create index if not exists saved_cars_tester_active_idx
  on public.saved_cars (tester_registration_id, updated_at desc)
  where deleted_at is null;

create index if not exists saved_cars_vehicle_idx
  on public.saved_cars (vehicle_id);

drop trigger if exists saved_cars_touch_updated_at on public.saved_cars;

create trigger saved_cars_touch_updated_at
before update on public.saved_cars
for each row
execute function public.touch_updated_at();

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  tester_registration_id uuid not null references public.tester_registrations(id) on delete cascade,
  title text,
  latest_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_tester_latest_idx
  on public.chat_sessions (tester_registration_id, latest_message_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_session_id uuid not null references public.chat_sessions(id) on delete cascade,
  tester_registration_id uuid not null references public.tester_registrations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_created_idx
  on public.chat_messages (chat_session_id, created_at asc);

create index if not exists chat_messages_tester_created_idx
  on public.chat_messages (tester_registration_id, created_at desc);

drop trigger if exists chat_sessions_touch_updated_at on public.chat_sessions;

create trigger chat_sessions_touch_updated_at
before update on public.chat_sessions
for each row
execute function public.touch_updated_at();

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists admin_users_email_unique_idx
  on public.admin_users (lower(email));

create index if not exists admin_users_active_idx
  on public.admin_users (active);

drop trigger if exists admin_users_touch_updated_at on public.admin_users;

create trigger admin_users_touch_updated_at
before update on public.admin_users
for each row
execute function public.touch_updated_at();
