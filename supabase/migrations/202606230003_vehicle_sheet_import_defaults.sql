-- Default technical / inventory fields when importing match-focused sheet CSVs.

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
