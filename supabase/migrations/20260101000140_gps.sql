-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- MÓDULO · GPS y localización
-- Depende de: core. Fuentes: teléfono del empleado (report_position) o
-- dispositivos/proveedores externos vía Edge Function gps-ingest (token).
-- =============================================================================
insert into public.app_modules (id, name) values ('gps', 'GPS') on conflict (id) do nothing;

insert into public.app_settings (key, value) values
  ('gps', '{"online_minutes": 5, "retention_days": 365, "phone_interval_seconds": 30}')
on conflict (key) do nothing;

create table public.gps_devices (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null default 'tracker' check (kind in ('tracker','phone','external')),
  provider      text,                         -- nombre del proveedor externo, si aplica
  external_id   text,                         -- IMEI o ID del proveedor
  vehicle_id    uuid references public.vehicles(id),
  token_hash    text,                         -- sha256 del token de ingestión (nunca el token)
  active        boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (provider, external_id)
);

create table public.gps_positions (
  id          bigint generated always as identity primary key,
  vehicle_id  uuid not null references public.vehicles(id),
  device_id   uuid references public.gps_devices(id),
  employee_id uuid references public.employees(id),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  speed_kmh   double precision,
  heading     double precision,
  accuracy_m  double precision,
  source      text not null default 'phone' check (source in ('phone','tracker','external'))
);
create index gps_positions_vehicle_time_idx on public.gps_positions(vehicle_id, recorded_at desc);

-- Última posición por vehículo (lectura rápida del mapa)
create table public.gps_last_positions (
  vehicle_id  uuid primary key references public.vehicles(id),
  recorded_at timestamptz not null,
  lat         double precision not null,
  lng         double precision not null,
  speed_kmh   double precision,
  heading     double precision,
  accuracy_m  double precision,
  source      text not null,
  employee_id uuid references public.employees(id),
  device_id   uuid references public.gps_devices(id)
);

create or replace function app.gps_update_last()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.gps_last_positions as l (vehicle_id, recorded_at, lat, lng, speed_kmh, heading, accuracy_m, source, employee_id, device_id)
  values (new.vehicle_id, new.recorded_at, new.lat, new.lng, new.speed_kmh, new.heading, new.accuracy_m, new.source, new.employee_id, new.device_id)
  on conflict (vehicle_id) do update set recorded_at = excluded.recorded_at, lat = excluded.lat, lng = excluded.lng,
     speed_kmh = excluded.speed_kmh, heading = excluded.heading, accuracy_m = excluded.accuracy_m,
     source = excluded.source, employee_id = excluded.employee_id, device_id = excluded.device_id
   where l.recorded_at < excluded.recorded_at;
  if new.device_id is not null then
    update public.gps_devices set last_seen_at = new.received_at where id = new.device_id;
  end if;
  return new;
end $$;
create trigger gps_positions_last after insert on public.gps_positions
  for each row execute function app.gps_update_last();

-- Desde el teléfono: la posición se asocia al vehículo asignado al empleado
create or replace function public.report_position(p_lat float8, p_lng float8, p_speed float8 default null,
  p_heading float8 default null, p_accuracy float8 default null, p_recorded_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid := app.current_employee_id(); v_vehicle uuid;
begin
  perform app.require_perm('gps.report');
  select vehicle_id into v_vehicle from public.vehicle_assignments where employee_id = v_emp and ended_at is null;
  if v_vehicle is null then return; end if;   -- sin vehículo asignado: no se rastrea a la persona
  insert into public.gps_positions(vehicle_id, employee_id, recorded_at, lat, lng, speed_kmh, heading, accuracy_m, source)
  values (v_vehicle, v_emp, least(coalesce(p_recorded_at, now()), now()), p_lat, p_lng, p_speed, p_heading, p_accuracy, 'phone');
end $$;

-- Ingesta de dispositivos (solo service_role, desde la Edge Function gps-ingest)
-- p_points: [{lat, lng, speed_kmh, heading, accuracy_m, recorded_at}]
create or replace function public.gps_ingest(p_token_hash text, p_points jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare d public.gps_devices; n int;
begin
  select * into d from public.gps_devices where token_hash = p_token_hash and active;
  if d.id is null then raise exception 'Dispositivo no autorizado' using errcode = '42501'; end if;
  if d.vehicle_id is null then raise exception 'Dispositivo sin vehículo asignado' using errcode = '22023'; end if;
  insert into public.gps_positions(vehicle_id, device_id, recorded_at, lat, lng, speed_kmh, heading, accuracy_m, source)
  select d.vehicle_id, d.id, least(coalesce((x->>'recorded_at')::timestamptz, now()), now()),
         (x->>'lat')::float8, (x->>'lng')::float8, (x->>'speed_kmh')::float8, (x->>'heading')::float8,
         (x->>'accuracy_m')::float8, case d.kind when 'external' then 'external' else 'tracker' end
    from jsonb_array_elements(p_points) x;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.gps_ingest(text, jsonb) from public, anon, authenticated;

-- Registro de dispositivos: devuelve el token UNA sola vez
create or replace function public.register_gps_device(p_name text, p_kind text, p_vehicle uuid,
  p_provider text default null, p_external_id text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex'); v_id uuid;
begin
  perform app.require_perm('gps.manage');
  insert into public.gps_devices(name, kind, vehicle_id, provider, external_id, token_hash)
  values (p_name, p_kind, p_vehicle, p_provider, p_external_id, encode(extensions.digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace view public.gps_fleet_map with (security_invoker = true) as
  select v.id as vehicle_id, v.unit_number, v.status, m.manufacturer, m.model, m.year,
         l.lat, l.lng, l.speed_kmh, l.heading, l.recorded_at, l.source, l.employee_id, e.full_name as employee_name,
         (l.recorded_at > now() - make_interval(mins => coalesce(
            (select (value->>'online_minutes')::int from public.app_settings where key = 'gps'), 5))) as online
    from public.vehicles v
    join public.vehicle_models m on m.id = v.model_id
    left join public.gps_last_positions l on l.vehicle_id = v.id
    left join public.employees e on e.id = l.employee_id
   where v.archived_at is null;

create or replace function app.gps_cleanup()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.gps_positions where recorded_at < now() - make_interval(days => coalesce(
    (select (value->>'retention_days')::int from public.app_settings where key = 'gps'), 365));
end $$;
insert into public.alert_jobs values ('gps', 'gps_cleanup') on conflict do nothing;

insert into public.permissions (id, module_id, action, label, sort) values
  ('gps.view',   'gps', 'view',   'Ver mapa e historial de ubicaciones', 1),
  ('gps.report', 'gps', 'report', 'Enviar ubicación desde el teléfono', 2),
  ('gps.manage', 'gps', 'manage', 'Administrar dispositivos GPS', 3)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','gps.view'), ('supervisor','gps.report'), ('driver','gps.report')
on conflict do nothing;

alter table public.gps_devices        enable row level security;
alter table public.gps_positions      enable row level security;
alter table public.gps_last_positions enable row level security;
create policy gps_devices_read on public.gps_devices for select to authenticated using ((select app.has_perm('gps.view')));
create policy gps_devices_update on public.gps_devices for update to authenticated
  using ((select app.has_perm('gps.manage'))) with check ((select app.has_perm('gps.manage')));
create policy gps_positions_read on public.gps_positions for select to authenticated using ((select app.has_perm('gps.view')));
create policy gps_last_read on public.gps_last_positions for select to authenticated using ((select app.has_perm('gps.view')));
revoke insert on public.gps_devices, public.gps_positions, public.gps_last_positions from authenticated;
revoke update on public.gps_positions, public.gps_last_positions from authenticated;
-- token_hash nunca sale por la API: privilegios por columna
revoke select, update on public.gps_devices from authenticated;
grant select (id, name, kind, provider, external_id, vehicle_id, active, last_seen_at, created_at, updated_at)
  on public.gps_devices to authenticated;
grant update (name, vehicle_id, active) on public.gps_devices to authenticated;

do $$ begin
  perform app.track('public.gps_devices');
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.gps_last_positions;
  end if;
end $$;
