-- Seed four online PulseBox AED nodes near 32.6328, 75.0302.
-- Re-running this script does not add duplicate device UIDs.
do $$
declare
  seed_owner_id uuid;
begin
  select id
    into seed_owner_id
    from public.profiles
    order by created_at, id
    limit 1;

  if seed_owner_id is null then
    raise exception 'Create at least one profile before seeding hardware nodes.';
  end if;

  insert into public.hardware_nodes (
    owner_id,
    device_uid,
    node_type,
    label,
    firmware_version,
    lat,
    lng,
    geohash,
    status,
    aed_status,
    battery_pct,
    last_telemetry,
    last_ping_at
  )
  values
    (
      seed_owner_id, 'PG-PB-AED-UDH-001', 'PULSEBOX_AED', 'PulseBox AED - Central Sector',
      '2.4.1', 32.6328, 75.0302, 'ttv3eke', 'ONLINE', 'READY', 96,
      '{"cabinet_temp_c":22.4,"pads_expiry":"2027-06"}'::jsonb, now()
    ),
    (
      seed_owner_id, 'PG-PB-AED-UDH-002', 'PULSEBOX_AED', 'PulseBox AED - North Sector',
      '2.4.1', 32.6374, 75.0261, 'ttv3em2', 'ONLINE', 'READY', 91,
      '{"cabinet_temp_c":23.1,"pads_expiry":"2027-09"}'::jsonb, now()
    ),
    (
      seed_owner_id, 'PG-PB-AED-UDH-003', 'PULSEBOX_AED', 'PulseBox AED - East Sector',
      '2.4.1', 32.6289, 75.0350, 'ttv3e7y', 'ONLINE', 'READY', 88,
      '{"cabinet_temp_c":21.8,"pads_expiry":"2027-04"}'::jsonb, now()
    ),
    (
      seed_owner_id, 'PG-PB-AED-UDH-004', 'PULSEBOX_AED', 'PulseBox AED - South Sector',
      '2.4.1', 32.6392, 75.0386, 'ttv3etc', 'ONLINE', 'READY', 94,
      '{"cabinet_temp_c":22.7,"pads_expiry":"2027-11"}'::jsonb, now()
    )
  on conflict (device_uid) do nothing;
end;
$$;
