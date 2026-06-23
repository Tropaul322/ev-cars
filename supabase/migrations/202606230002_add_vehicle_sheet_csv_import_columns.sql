-- Allow flat CSV imports (vehicles-sheet-template.csv) by replacing generated
-- columns with writable sheet columns and syncing payload via trigger.

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

alter table public.vehicles
  drop column if exists source,
  drop column if exists brand,
  drop column if exists make,
  drop column if exists model,
  drop column if exists title,
  drop column if exists condition,
  drop column if exists price_eur,
  drop column if exists monthly_lease_eur,
  drop column if exists available,
  drop column if exists mileage_km,
  drop column if exists range_km,
  drop column if exists battery_soh,
  drop column if exists body_type,
  drop column if exists seats,
  drop column if exists dedupe_key,
  drop column if exists source_listing_id,
  drop column if exists listing_url,
  drop column if exists manufacturer_country,
  drop column if exists manufacturer_country_code,
  drop column if exists seller_type,
  drop column if exists inventory_fingerprint,
  drop column if exists crawled_at,
  drop column if exists market,
  drop column if exists year,
  drop column if exists location,
  drop column if exists transmission,
  drop column if exists exterior_color,
  drop column if exists doors,
  drop column if exists leasing_eligible,
  drop column if exists lease_duration_months,
  drop column if exists source_updated_at,
  drop column if exists vat_deductible,
  drop column if exists brand_origin,
  drop column if exists power_kw;

alter table public.vehicles
  add column if not exists source text,
  add column if not exists brand text,
  add column if not exists make text,
  add column if not exists model text,
  add column if not exists trim text,
  add column if not exists title text,
  add column if not exists condition text,
  add column if not exists price_eur integer,
  add column if not exists monthly_lease_eur integer,
  add column if not exists available boolean default false,
  add column if not exists mileage_km integer,
  add column if not exists range_km integer,
  add column if not exists efficiency_kwh_per_100_km numeric,
  add column if not exists battery_kwh numeric,
  add column if not exists battery_soh numeric,
  add column if not exists body_type text,
  add column if not exists seats integer,
  add column if not exists cargo_liters integer,
  add column if not exists drivetrain text,
  add column if not exists power_kw numeric,
  add column if not exists features text,
  add column if not exists images text,
  add column if not exists notes text,
  add column if not exists review_tags text,
  add column if not exists dedupe_key text,
  add column if not exists source_listing_id text,
  add column if not exists listing_url text,
  add column if not exists manufacturer_country text,
  add column if not exists manufacturer_country_code text,
  add column if not exists seller_type text,
  add column if not exists inventory_fingerprint text,
  add column if not exists crawled_at timestamptz,
  add column if not exists market text,
  add column if not exists year integer,
  add column if not exists location text,
  add column if not exists transmission text,
  add column if not exists exterior_color text,
  add column if not exists doors integer,
  add column if not exists leasing_eligible boolean,
  add column if not exists lease_duration_months integer,
  add column if not exists source_updated_at timestamptz,
  add column if not exists vat_deductible boolean,
  add column if not exists brand_origin text;

create or replace function public.vehicles_build_payload_from_columns(v public.vehicles)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
  warranty_text text;
begin
  warranty_text := case
    when v.condition = 'new' then 'New listing; verify factory and battery warranty with seller.'
    else 'Used listing; verify remaining battery warranty and battery state-of-health with seller.'
  end;

  result := jsonb_strip_nulls(
    jsonb_build_object(
      'id', v.id,
      'source', v.source,
      'market', v.market,
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
      'available', v.available,
      'location', v.location,
      'listingUrl', v.listing_url,
      'title', v.title,
      'notes', coalesce(nullif(btrim(v.notes), ''), 'Imported from spreadsheet.'),
      'brandOrigin', v.brand_origin,
      'dedupeKey', coalesce(v.dedupe_key, v.id),
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
      new.payload := public.vehicles_build_payload_from_columns(new);
    end if;
  elsif new.payload is distinct from old.payload then
    new := public.vehicles_set_columns_from_payload(new);
  else
    new.payload := public.vehicles_build_payload_from_columns(new);
  end if;

  if new.payload is null or new.payload = '{}'::jsonb then
    raise exception 'vehicles row requires payload or sheet columns (id=%)', new.id;
  end if;

  return new;
end;
$$;

alter table public.vehicles
  alter column payload drop not null,
  alter column payload set default '{}'::jsonb;

update public.vehicles as v
set
  source = v.payload ->> 'source',
  brand = coalesce(v.payload ->> 'brand', v.payload ->> 'make'),
  make = v.payload ->> 'make',
  model = v.payload ->> 'model',
  trim = v.payload ->> 'trim',
  title = v.payload ->> 'title',
  condition = v.payload ->> 'condition',
  price_eur = public.vehicles_safe_int(v.payload ->> 'priceEUR'),
  monthly_lease_eur = public.vehicles_safe_int(v.payload ->> 'monthlyLeaseEUR'),
  available = coalesce((v.payload ->> 'available')::boolean, false),
  mileage_km = public.vehicles_safe_int(v.payload ->> 'mileageKm'),
  range_km = public.vehicles_safe_int(v.payload ->> 'rangeKm'),
  efficiency_kwh_per_100_km = public.vehicles_safe_numeric(v.payload ->> 'efficiencyKwhPer100Km'),
  battery_kwh = public.vehicles_safe_numeric(v.payload ->> 'batteryKwh'),
  battery_soh = public.vehicles_safe_numeric(v.payload ->> 'batterySoH'),
  body_type = v.payload ->> 'bodyType',
  seats = public.vehicles_safe_int(v.payload ->> 'seats'),
  cargo_liters = public.vehicles_safe_int(v.payload ->> 'cargoLiters'),
  drivetrain = v.payload ->> 'drivetrain',
  power_kw = public.vehicles_safe_numeric(v.payload ->> 'powerKw'),
  features = public.vehicles_json_array_to_pipe_text(v.payload -> 'features'),
  images = public.vehicles_json_array_to_pipe_text(v.payload -> 'images'),
  notes = v.payload ->> 'notes',
  review_tags = public.vehicles_json_array_to_pipe_text(v.payload -> 'reviewTags'),
  dedupe_key = v.payload ->> 'dedupeKey',
  source_listing_id = v.payload ->> 'sourceListingId',
  listing_url = v.payload ->> 'listingUrl',
  manufacturer_country = v.payload ->> 'manufacturerCountry',
  manufacturer_country_code = v.payload ->> 'manufacturerCountryCode',
  seller_type = v.payload ->> 'sellerType',
  inventory_fingerprint = v.payload ->> 'inventoryFingerprint',
  crawled_at = nullif(v.payload ->> 'crawledAt', '')::timestamptz,
  market = v.payload ->> 'market',
  year = public.vehicles_safe_int(v.payload ->> 'year'),
  location = v.payload ->> 'location',
  transmission = v.payload ->> 'transmission',
  exterior_color = v.payload ->> 'exteriorColor',
  doors = public.vehicles_safe_int(v.payload ->> 'doors'),
  leasing_eligible = nullif(v.payload ->> 'leasingEligible', '')::boolean,
  lease_duration_months = public.vehicles_safe_int(v.payload ->> 'leaseDurationMonths'),
  source_updated_at = nullif(v.payload ->> 'sourceUpdatedAt', '')::timestamptz,
  vat_deductible = nullif(v.payload ->> 'vatDeductible', '')::boolean,
  brand_origin = v.payload ->> 'brandOrigin';

alter table public.vehicles
  alter column payload set not null;

drop trigger if exists vehicles_sync_sheet_row on public.vehicles;

create trigger vehicles_sync_sheet_row
before insert or update on public.vehicles
for each row
execute function public.vehicles_sync_sheet_row();

create unique index if not exists vehicles_dedupe_key_unique
  on public.vehicles (dedupe_key)
  where dedupe_key is not null;

create index if not exists vehicles_trim_idx on public.vehicles (trim);
create index if not exists vehicles_battery_kwh_idx on public.vehicles (battery_kwh);
create index if not exists vehicles_drivetrain_idx on public.vehicles (drivetrain);
