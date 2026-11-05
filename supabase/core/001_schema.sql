-- =============================================================================
-- CORE · Fundamentos del sistema
-- Siempre instalado. Contiene: registro de módulos, ajustes, roles/permisos,
-- empleados + credenciales PIN, flota (modelos, vehículos, lecturas),
-- adjuntos, línea de tiempo del vehículo, auditoría y notificaciones.
-- Los módulos opcionales dependen del core; el core NUNCA depende de un módulo.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Privilegios explícitos de la API (los proyectos nuevos de Supabase ya no los dan por defecto).
-- Cada módulo luego restringe lo que no debe escribirse directamente (solo vía funciones).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Esquema privado: funciones internas no expuestas por la API REST.
create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Registro de módulos (activar / desactivar por cliente sin borrar datos)
-- -----------------------------------------------------------------------------
create table public.app_modules (
  id           text primary key,
  name         text not null,
  is_core      boolean not null default false,
  enabled      boolean not null default true,
  trial_until  timestamptz,               -- módulo en prueba: deja de operar al vencer
  installed_at timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on column public.app_modules.trial_until is
  'Si tiene fecha y ya pasó, el módulo deja de operar. Los datos se conservan siempre.';

insert into public.app_modules (id, name, is_core) values
  ('core', 'Núcleo', true),
  ('employees', 'Empleados', true),
  ('fleet', 'Flota', true),
  ('notifications', 'Notificaciones', true),
  ('settings', 'Configuración', true);

create or replace function app.module_enabled(p_module text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.is_core or (m.enabled and (m.trial_until is null or m.trial_until > now()))
       from public.app_modules m where m.id = p_module),
    false);
$$;

-- -----------------------------------------------------------------------------
-- Ajustes generales (clave/valor)
-- -----------------------------------------------------------------------------
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('company', '{"name": "Mi Compañía", "timezone": "America/Puerto_Rico"}'),
  ('security', '{"max_failed_pin_attempts": 5, "lockout_minutes": 15, "session_hours": 12}');

-- -----------------------------------------------------------------------------
-- Roles y permisos (RBAC granular + excepciones por empleado)
-- -----------------------------------------------------------------------------
create table public.roles (
  id          text primary key,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  home_path   text not null default '/',
  created_at  timestamptz not null default now()
);
insert into public.roles (id, name, description, is_system, home_path) values
  ('admin',      'Administrador',     'Acceso completo a todos los módulos', true, '/dashboard'),
  ('supervisor', 'Supervisor',        'Supervisa operaciones y aprueba',     true, '/dashboard'),
  ('driver',     'Chofer / Operador', 'Opera vehículos y reporta',           true, '/m'),
  ('mechanic',   'Mecánico',          'Taller, diagnósticos y reparaciones', true, '/taller');

create table public.permissions (
  id          text primary key,             -- formato: <modulo>.<accion>[_<alcance>]
  module_id   text not null references public.app_modules(id),
  action      text not null,                -- view, create, edit, delete, approve, manage, ...
  label       text not null,
  sort        int  not null default 0
);

create table public.role_permissions (
  role_id       text not null references public.roles(id) on delete cascade,
  permission_id text not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- -----------------------------------------------------------------------------
-- Empleados
-- -----------------------------------------------------------------------------
create table public.employees (
  id            uuid primary key default gen_random_uuid(),
  employee_code text not null unique check (employee_code ~ '^[A-Za-z0-9_-]{2,20}$'),
  full_name     text not null check (length(trim(full_name)) > 1),
  phone         text,
  job_title      text,
  role_id       text not null references public.roles(id),
  status        text not null default 'active' check (status in ('active','inactive','suspended')),
  auth_user_id  uuid unique,                 -- enlace con auth.users (lo crea pin-login)
  photo_path    text,
  hired_at      date,
  notes         text,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create index employees_role_idx on public.employees(role_id);
create index employees_status_idx on public.employees(status);

-- Credenciales separadas: ningún rol de la API puede leer esta tabla.
create table public.employee_credentials (
  employee_id     uuid primary key references public.employees(id) on delete cascade,
  pin_hash        text not null,
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  pin_changed_at  timestamptz not null default now()
);

create table public.employee_permission_overrides (
  employee_id   uuid not null references public.employees(id) on delete cascade,
  permission_id text not null references public.permissions(id) on delete cascade,
  granted       boolean not null,            -- true = concede, false = revoca
  primary key (employee_id, permission_id)
);

-- -----------------------------------------------------------------------------
-- Identidad y autorización (usadas por TODAS las políticas RLS)
-- -----------------------------------------------------------------------------
create or replace function app.current_employee_id()
returns uuid language sql stable security definer set search_path = public as $$
  select e.id from public.employees e
   where e.auth_user_id = auth.uid() and e.status = 'active';
$$;

create or replace function app.current_role_id()
returns text language sql stable security definer set search_path = public as $$
  select e.role_id from public.employees e
   where e.auth_user_id = auth.uid() and e.status = 'active';
$$;

-- has_perm: rol del empleado + excepciones individuales + módulo activo.
-- Lectura (acciones view*) se permite aunque el módulo esté desactivado,
-- para que el historial nunca se pierda. Escrituras requieren módulo activo.
create or replace function app.has_perm(p_perm text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_emp  uuid;
  v_role text;
  v_mod  text;
  v_act  text;
  v_ovr  boolean;
begin
  select e.id, e.role_id into v_emp, v_role
    from public.employees e where e.auth_user_id = auth.uid() and e.status = 'active';
  if v_emp is null then return false; end if;

  select p.module_id, p.action into v_mod, v_act from public.permissions p where p.id = p_perm;
  if v_mod is null then return false; end if;
  if v_act not like 'view%' and not app.module_enabled(v_mod) then return false; end if;

  select o.granted into v_ovr from public.employee_permission_overrides o
   where o.employee_id = v_emp and o.permission_id = p_perm;
  if v_ovr is not null then return v_ovr; end if;

  if v_role = 'admin' then return true; end if;
  return exists (select 1 from public.role_permissions rp
                  where rp.role_id = v_role and rp.permission_id = p_perm);
end $$;

create or replace function app.require_perm(p_perm text)
returns void language plpgsql stable as $$
begin
  if not app.has_perm(p_perm) then
    raise exception 'Permiso requerido: %', p_perm using errcode = '42501';
  end if;
end $$;

-- Lista de permisos efectivos del usuario (para la interfaz).
create or replace function public.my_permissions()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id order by p.id), '{}') from public.permissions p where app.has_perm(p.id);
$$;

create or replace function public.my_profile()
returns table (id uuid, employee_code text, full_name text, role_id text, role_name text,
               home_path text, job_title text, photo_path text)
language sql stable security definer set search_path = public as $$
  select e.id, e.employee_code, e.full_name, e.role_id, r.name, r.home_path, e.job_title, e.photo_path
    from public.employees e join public.roles r on r.id = e.role_id
   where e.id = app.current_employee_id();
$$;

-- -----------------------------------------------------------------------------
-- Sellos created_by / updated_by y auditoría genérica
-- -----------------------------------------------------------------------------
create or replace function app.stamp()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    begin new.created_by := coalesce(new.created_by, app.current_employee_id()); exception when undefined_column then null; end;
  end if;
  begin new.updated_at := now(); exception when undefined_column then null; end;
  begin new.updated_by := app.current_employee_id(); exception when undefined_column then null; end;
  return new;
end $$;

create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_fields text[],
  employee_id uuid,
  changed_at  timestamptz not null default now()
);
create index audit_log_table_record_idx on public.audit_log(table_name, record_id);
create index audit_log_changed_at_idx on public.audit_log(changed_at desc);

create or replace function app.audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_fields text[];
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old) - 'pin_hash'; end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new) - 'pin_hash'; end if;
  if tg_op = 'UPDATE' then
    select array_agg(k) into v_fields from jsonb_object_keys(v_new) k
     where v_new -> k is distinct from v_old -> k and k not in ('updated_at','updated_by');
    if v_fields is null then return new; end if;   -- nada relevante cambió
  end if;
  insert into public.audit_log(table_name, record_id, action, old_data, new_data, changed_fields, employee_id)
  values (tg_table_name, coalesce(v_new->>'id', v_old->>'id'), tg_op, v_old, v_new, v_fields,
          app.current_employee_id());
  return coalesce(new, old);
end $$;

-- Helper para que cada módulo registre auditoría y sellos en sus tablas.
create or replace function app.track(p_table regclass, p_stamp boolean default true)
returns void language plpgsql as $$
declare v_name text := split_part(p_table::text, '.', 2);
begin
  if v_name = '' then v_name := p_table::text; end if;
  execute format('create trigger %I after insert or update or delete on %s for each row execute function app.audit()',
                 v_name || '_audit', p_table);
  if p_stamp then
    execute format('create trigger %I before insert or update on %s for each row execute function app.stamp()',
                   v_name || '_stamp', p_table);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Flota: modelos, vehículos, estado, lecturas de horas/millaje
-- -----------------------------------------------------------------------------
create table public.vehicle_models (
  id               uuid primary key default gen_random_uuid(),
  manufacturer     text not null,
  model            text not null,
  year             int check (year between 1950 and 2100),
  vehicle_type     text not null default 'utv' check (vehicle_type in ('utv','atv','truck','car','van','equipment','other')),
  uses_engine_hours boolean not null default true,
  uses_mileage     boolean not null default false,
  notes            text,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  unique nulls not distinct (manufacturer, model, year)
);

-- Modelos iniciales indicados por la compañía (sin especificaciones inventadas).
insert into public.vehicle_models (manufacturer, model, year, vehicle_type, uses_engine_hours, uses_mileage) values
  ('Yanmar', 'Bull UTV', null, 'utv', true, false),
  ('Can-Am', 'Outlander', 2018, 'atv', true, true),
  ('Can-Am', 'Outlander', 2024, 'atv', true, true);

create table public.vehicles (
  id                  uuid primary key default gen_random_uuid(),
  unit_number         text not null unique check (length(trim(unit_number)) > 0),
  model_id            uuid not null references public.vehicle_models(id),
  vin                 text unique,
  plate               text,
  acquired_at         date,
  photo_path          text,
  status              text not null default 'available' check (status in
                        ('available','in_operation','assigned','maintenance','repair','out_of_service','retired')),
  status_reason       text,
  current_location    text,
  engine_hours        numeric(10,1) not null default 0 check (engine_hours >= 0),
  mileage             numeric(10,1) check (mileage >= 0),
  warranty_expires_at date,
  warranty_notes      text,
  -- Resúmenes mantenidos por los módulos (el historial vive en sus propias tablas)
  last_inspection_at  timestamptz,
  last_maintenance_at timestamptz,
  next_maintenance_at date,
  next_maintenance_hours numeric(10,1),
  notes               text,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid
);
create index vehicles_status_idx on public.vehicles(status) where archived_at is null;
create index vehicles_model_idx on public.vehicles(model_id);

create table public.vehicle_status_history (
  id          bigint generated always as identity primary key,
  vehicle_id  uuid not null references public.vehicles(id),
  from_status text,
  to_status   text not null,
  reason      text,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index vehicle_status_history_vehicle_idx on public.vehicle_status_history(vehicle_id, changed_at);

create or replace function app.vehicle_status_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.vehicle_status_history(vehicle_id, from_status, to_status, reason, changed_by)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, new.status_reason,
            app.current_employee_id());
  end if;
  return new;
end $$;
create trigger vehicles_status_log after insert or update of status on public.vehicles
  for each row execute function app.vehicle_status_log();

create table public.vehicle_meter_readings (
  id           bigint generated always as identity primary key,
  vehicle_id   uuid not null references public.vehicles(id),
  engine_hours numeric(10,1),
  mileage      numeric(10,1),
  source       text not null default 'manual',   -- manual, inspection, fuel, maintenance, workorder
  source_id    uuid,
  employee_id  uuid references public.employees(id),
  recorded_at  timestamptz not null default now(),
  check (engine_hours is not null or mileage is not null)
);
create index vehicle_meter_readings_vehicle_idx on public.vehicle_meter_readings(vehicle_id, recorded_at desc);

-- Única vía para actualizar horas/millaje: valida que no retrocedan.
create or replace function app.record_meter(p_vehicle uuid, p_hours numeric, p_miles numeric,
                                            p_source text, p_source_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.vehicles;
begin
  if p_hours is null and p_miles is null then return; end if;
  select * into v from public.vehicles where id = p_vehicle for update;
  if p_hours is not null and p_hours < v.engine_hours then
    raise exception 'Las horas de motor (%) no pueden ser menores a las registradas (%)', p_hours, v.engine_hours
      using errcode = '22023';
  end if;
  if p_miles is not null and v.mileage is not null and p_miles < v.mileage then
    raise exception 'El millaje (%) no puede ser menor al registrado (%)', p_miles, v.mileage using errcode = '22023';
  end if;
  insert into public.vehicle_meter_readings(vehicle_id, engine_hours, mileage, source, source_id, employee_id)
  values (p_vehicle, p_hours, p_miles, p_source, p_source_id, app.current_employee_id());
  update public.vehicles set engine_hours = coalesce(p_hours, engine_hours),
                             mileage = coalesce(p_miles, mileage)
   where id = p_vehicle;
end $$;

create or replace function public.record_meter_reading(p_vehicle uuid, p_hours numeric, p_miles numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('fleet.edit');
  perform app.record_meter(p_vehicle, p_hours, p_miles, 'manual');
end $$;

-- Asignación permanente chofer ↔ vehículo ("Mi vehículo")
create table public.vehicle_assignments (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles(id),
  employee_id uuid not null references public.employees(id),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  check (ended_at is null or ended_at > started_at)
);
create unique index vehicle_assignments_one_active_per_employee
  on public.vehicle_assignments(employee_id) where ended_at is null;
create index vehicle_assignments_vehicle_idx on public.vehicle_assignments(vehicle_id) where ended_at is null;

create or replace function public.assign_vehicle(p_vehicle uuid, p_employee uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform app.require_perm('fleet.assign');
  update public.vehicle_assignments set ended_at = now()
   where employee_id = p_employee and ended_at is null;
  insert into public.vehicle_assignments(vehicle_id, employee_id, notes)
  values (p_vehicle, p_employee, p_notes) returning id into v_id;
  update public.vehicles set status = 'assigned', status_reason = null
   where id = p_vehicle and status = 'available';
  return v_id;
end $$;

create or replace function public.end_vehicle_assignment(p_assignment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_vehicle uuid;
begin
  perform app.require_perm('fleet.assign');
  update public.vehicle_assignments set ended_at = now()
   where id = p_assignment and ended_at is null returning vehicle_id into v_vehicle;
  if v_vehicle is not null and not exists
     (select 1 from public.vehicle_assignments where vehicle_id = v_vehicle and ended_at is null) then
    update public.vehicles set status = 'available' where id = v_vehicle and status = 'assigned';
  end if;
end $$;

create or replace function public.my_vehicle()
returns setof public.vehicles language sql stable security definer set search_path = public as $$
  select v.* from public.vehicles v
    join public.vehicle_assignments a on a.vehicle_id = v.id and a.ended_at is null
   where a.employee_id = app.current_employee_id();
$$;

create or replace function public.set_vehicle_status(p_vehicle uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('fleet.edit');
  update public.vehicles set status = p_status, status_reason = p_reason where id = p_vehicle;
end $$;

-- -----------------------------------------------------------------------------
-- Línea de tiempo del vehículo: cada módulo publica sus eventos aquí.
-- Es un índice cronológico; el detalle vive en la tabla del módulo (entity_*).
-- -----------------------------------------------------------------------------
create table public.vehicle_timeline (
  id           bigint generated always as identity primary key,
  vehicle_id   uuid not null references public.vehicles(id),
  occurred_at  timestamptz not null default now(),
  module_id    text not null references public.app_modules(id),
  event_type   text not null,
  title        text not null,
  details      jsonb not null default '{}',
  entity_type  text,
  entity_id    uuid,
  employee_id  uuid references public.employees(id),
  cost         numeric(12,2),
  labor_hours  numeric(8,2),
  created_at   timestamptz not null default now()
);
create index vehicle_timeline_vehicle_idx on public.vehicle_timeline(vehicle_id, occurred_at desc);

create or replace function app.timeline_add(p_vehicle uuid, p_module text, p_type text, p_title text,
  p_entity_type text default null, p_entity_id uuid default null, p_details jsonb default '{}',
  p_cost numeric default null, p_labor numeric default null, p_at timestamptz default now(),
  p_employee uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.vehicle_timeline(vehicle_id, occurred_at, module_id, event_type, title, details,
                                      entity_type, entity_id, employee_id, cost, labor_hours)
  values (p_vehicle, coalesce(p_at, now()), p_module, p_type, p_title, coalesce(p_details, '{}'),
          p_entity_type, p_entity_id, coalesce(p_employee, app.current_employee_id()), p_cost, p_labor);
$$;

-- -----------------------------------------------------------------------------
-- Adjuntos genéricos (fotos, PDFs) reutilizados por todos los módulos
-- -----------------------------------------------------------------------------
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  module_id    text not null references public.app_modules(id),
  entity_type  text not null,
  entity_id    uuid not null,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint,
  caption      text,
  uploaded_by  uuid references public.employees(id) default app.current_employee_id(),
  created_at   timestamptz not null default now(),
  archived_at  timestamptz
);
create index attachments_entity_idx on public.attachments(entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- Notificaciones dirigidas por rol o por empleado
-- -----------------------------------------------------------------------------
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  module_id     text not null references public.app_modules(id),
  type          text not null,
  severity      text not null default 'info' check (severity in ('info','warning','critical')),
  title         text not null,
  body          text,
  link          text,
  recipient_role text references public.roles(id),
  recipient_employee_id uuid references public.employees(id),
  entity_type   text,
  entity_id     uuid,
  dedupe_key    text unique,                 -- evita alertas repetidas del mismo evento
  created_at    timestamptz not null default now(),
  check (recipient_role is not null or recipient_employee_id is not null)
);
create index notifications_role_idx on public.notifications(recipient_role, created_at desc);
create index notifications_employee_idx on public.notifications(recipient_employee_id, created_at desc);

create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  employee_id     uuid not null references public.employees(id),
  read_at         timestamptz not null default now(),
  primary key (notification_id, employee_id)
);

-- Envía a uno o varios roles (una fila por rol). dedupe_key se sufija por rol.
create or replace function app.notify(p_roles text[], p_module text, p_type text, p_title text,
  p_body text default null, p_link text default null, p_severity text default 'info',
  p_entity_type text default null, p_entity_id uuid default null, p_dedupe text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r text;
begin
  foreach r in array p_roles loop
    insert into public.notifications(module_id, type, severity, title, body, link, recipient_role,
                                     entity_type, entity_id, dedupe_key)
    values (p_module, p_type, p_severity, p_title, p_body, p_link, r, p_entity_type, p_entity_id,
            case when p_dedupe is null then null else p_dedupe || ':' || r end)
    on conflict (dedupe_key) do nothing;
  end loop;
end $$;

create or replace function app.notify_employee(p_employee uuid, p_module text, p_type text, p_title text,
  p_body text default null, p_link text default null, p_severity text default 'info',
  p_entity_type text default null, p_entity_id uuid default null, p_dedupe text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications(module_id, type, severity, title, body, link, recipient_employee_id,
                                   entity_type, entity_id, dedupe_key)
  values (p_module, p_type, p_severity, p_title, p_body, p_link, p_employee, p_entity_type, p_entity_id, p_dedupe)
  on conflict (dedupe_key) do nothing;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  insert into public.notification_reads(notification_id, employee_id)
  select n.id, app.current_employee_id() from public.notifications n
   where n.id = any(p_ids)
     and (n.recipient_employee_id = app.current_employee_id() or n.recipient_role = app.current_role_id())
  on conflict do nothing;
$$;

create or replace view public.my_notifications with (security_invoker = true) as
  select n.*, (r.read_at is not null) as is_read, r.read_at
    from public.notifications n
    left join public.notification_reads r on r.notification_id = n.id and r.employee_id = app.current_employee_id()
   where n.recipient_employee_id = app.current_employee_id()
      or n.recipient_role = app.current_role_id();

-- -----------------------------------------------------------------------------
-- Tareas de alerta programadas: cada módulo registra la suya.
-- public.run_alerts() se ejecuta cada hora (pg_cron o Edge Function daily-alerts).
-- -----------------------------------------------------------------------------
create table public.alert_jobs (
  module_id  text not null references public.app_modules(id),
  fn_name    text not null,                  -- función en esquema app, sin argumentos
  primary key (module_id, fn_name)
);

create or replace function public.run_alerts()
returns jsonb language plpgsql security definer set search_path = public as $$
declare j record; v_out jsonb := '{}';
begin
  for j in select * from public.alert_jobs loop
    if app.module_enabled(j.module_id) then
      begin
        execute format('select app.%I()', j.fn_name);
        v_out := v_out || jsonb_build_object(j.fn_name, 'ok');
      exception when others then
        v_out := v_out || jsonb_build_object(j.fn_name, sqlerrm);
      end;
    end if;
  end loop;
  return v_out;
end $$;
revoke execute on function public.run_alerts() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Gestión de empleados y PIN (operaciones sensibles en servidor)
-- -----------------------------------------------------------------------------
create or replace function app.validate_pin(p_pin text)
returns void language plpgsql immutable as $$
begin
  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'El PIN debe tener entre 4 y 8 dígitos' using errcode = '22023';
  end if;
  if p_pin ~ '^(.)\1+$' or p_pin in ('1234','12345','123456','1234567','12345678','4321','0123') then
    raise exception 'El PIN es demasiado fácil de adivinar' using errcode = '22023';
  end if;
end $$;

create or replace function public.create_employee(p_code text, p_name text, p_role text, p_pin text,
  p_phone text default null, p_job_title text default null, p_hired_at date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform app.require_perm('employees.create');
  if p_role = 'admin' and not app.has_perm('employees.manage') then
    raise exception 'Solo quien administra permisos puede crear administradores' using errcode = '42501';
  end if;
  perform app.validate_pin(p_pin);
  insert into public.employees(employee_code, full_name, role_id, phone, job_title, hired_at, notes)
  values (upper(trim(p_code)), trim(p_name), p_role, p_phone, p_job_title, p_hired_at, p_notes)
  returning id into v_id;
  insert into public.employee_credentials(employee_id, pin_hash)
  values (v_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)));
  return v_id;
end $$;

create or replace function public.set_employee_pin(p_employee uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_employee is distinct from app.current_employee_id() then
    perform app.require_perm('employees.manage');
  end if;
  perform app.validate_pin(p_pin);
  insert into public.employee_credentials(employee_id, pin_hash)
  values (p_employee, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  on conflict (employee_id) do update
     set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, pin_changed_at = now();
  insert into public.audit_log(table_name, record_id, action, new_data, employee_id)
  values ('employee_credentials', p_employee::text, 'UPDATE', '{"pin":"changed"}', app.current_employee_id());
end $$;

create or replace function public.set_employee_status(p_employee uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('employees.edit');
  if p_employee = app.current_employee_id() and p_status <> 'active' then
    raise exception 'No puede desactivar su propia cuenta' using errcode = '22023';
  end if;
  update public.employees set status = p_status where id = p_employee;
  if p_status <> 'active' then
    update public.vehicle_assignments set ended_at = now() where employee_id = p_employee and ended_at is null;
  end if;
end $$;

-- Verificación de PIN: SOLO la llama la Edge Function pin-login (service_role).
create or replace function public.verify_employee_pin(p_code text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  e public.employees; c public.employee_credentials;
  v_max int; v_lock int;
begin
  select (value->>'max_failed_pin_attempts')::int, (value->>'lockout_minutes')::int
    into v_max, v_lock from public.app_settings where key = 'security';
  v_max := coalesce(v_max, 5); v_lock := coalesce(v_lock, 15);

  select * into e from public.employees where employee_code = upper(trim(p_code));
  if e.id is null then
    perform extensions.crypt(p_pin, extensions.gen_salt('bf', 10));  -- tiempo constante
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into c from public.employee_credentials where employee_id = e.id for update;
  if e.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  if c.locked_until is not null and c.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', c.locked_until);
  end if;
  if c.pin_hash is null or extensions.crypt(p_pin, c.pin_hash) <> c.pin_hash then
    update public.employee_credentials
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= v_max then now() + make_interval(mins => v_lock) end
     where employee_id = e.id;
    insert into public.audit_log(table_name, record_id, action, new_data)
    values ('auth', e.id::text, 'UPDATE', jsonb_build_object('event','pin_failed'));
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.employee_credentials set failed_attempts = 0, locked_until = null where employee_id = e.id;
  update public.employees set last_login_at = now() where id = e.id;
  insert into public.audit_log(table_name, record_id, action, new_data, employee_id)
  values ('auth', e.id::text, 'UPDATE', jsonb_build_object('event','login'), e.id);
  return jsonb_build_object('ok', true, 'employee_id', e.id, 'auth_user_id', e.auth_user_id,
                            'role_id', e.role_id);
end $$;

create or replace function public.link_employee_auth(p_employee uuid, p_auth uuid)
returns void language sql security definer set search_path = public as $$
  update public.employees set auth_user_id = p_auth where id = p_employee and auth_user_id is null;
$$;

revoke execute on function public.verify_employee_pin(text, text) from public, anon, authenticated;
revoke execute on function public.link_employee_auth(uuid, uuid) from public, anon, authenticated;

-- Excepciones de permisos por empleado
create or replace function public.set_permission_override(p_employee uuid, p_perm text, p_granted boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('employees.manage');
  if p_granted is null then
    delete from public.employee_permission_overrides where employee_id = p_employee and permission_id = p_perm;
  else
    insert into public.employee_permission_overrides values (p_employee, p_perm, p_granted)
    on conflict (employee_id, permission_id) do update set granted = excluded.granted;
  end if;
end $$;

create or replace function public.set_role_permission(p_role text, p_perm text, p_granted boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('settings.manage');
  if p_role = 'admin' then raise exception 'El rol administrador siempre tiene todos los permisos'; end if;
  if p_granted then
    insert into public.role_permissions values (p_role, p_perm) on conflict do nothing;
  else
    delete from public.role_permissions where role_id = p_role and permission_id = p_perm;
  end if;
end $$;

create or replace function public.set_module_state(p_module text, p_enabled boolean, p_trial_until timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('settings.manage');
  update public.app_modules set enabled = p_enabled, trial_until = p_trial_until, updated_at = now()
   where id = p_module and not is_core;
end $$;

-- -----------------------------------------------------------------------------
-- Permisos del núcleo
-- -----------------------------------------------------------------------------
insert into public.permissions (id, module_id, action, label, sort) values
  ('fleet.view',       'fleet', 'view',    'Ver vehículos', 1),
  ('fleet.view_own',   'fleet', 'view_own','Ver su vehículo asignado', 2),
  ('fleet.create',     'fleet', 'create',  'Añadir vehículos', 3),
  ('fleet.edit',       'fleet', 'edit',    'Editar vehículos y estado', 4),
  ('fleet.delete',     'fleet', 'delete',  'Archivar vehículos', 5),
  ('fleet.assign',     'fleet', 'assign',  'Asignar vehículos a empleados', 6),
  ('fleet.manage',     'fleet', 'manage',  'Administrar modelos de vehículo', 7),
  ('employees.view',   'employees', 'view',   'Ver empleados', 1),
  ('employees.create', 'employees', 'create', 'Crear empleados', 2),
  ('employees.edit',   'employees', 'edit',   'Editar y activar/desactivar empleados', 3),
  ('employees.manage', 'employees', 'manage', 'Cambiar PIN y permisos individuales', 4),
  ('notifications.view','notifications','view','Ver notificaciones', 1),
  ('settings.view',    'settings', 'view',   'Ver configuración y auditoría', 1),
  ('settings.manage',  'settings', 'manage', 'Administrar roles, módulos y ajustes', 2);

insert into public.role_permissions (role_id, permission_id) values
  ('supervisor','fleet.view'), ('supervisor','fleet.view_own'), ('supervisor','fleet.edit'), ('supervisor','fleet.assign'),
  ('supervisor','employees.view'), ('supervisor','notifications.view'),
  ('driver','fleet.view_own'), ('driver','notifications.view'),
  ('mechanic','fleet.view'), ('mechanic','fleet.view_own'), ('mechanic','notifications.view');

-- -----------------------------------------------------------------------------
-- Auditoría y sellos en tablas del núcleo
-- -----------------------------------------------------------------------------
do $$ begin perform app.track('public.employees'); end $$;
do $$ begin perform app.track('public.vehicle_models'); end $$;
do $$ begin perform app.track('public.vehicles'); end $$;
do $$ begin perform app.track('public.vehicle_assignments', false); end $$;
do $$ begin perform app.track('public.roles', false); end $$;
do $$ begin perform app.track('public.role_permissions', false); end $$;
do $$ begin perform app.track('public.employee_permission_overrides', false); end $$;
do $$ begin perform app.track('public.app_modules', false); end $$;
do $$ begin perform app.track('public.app_settings', false); end $$;

-- -----------------------------------------------------------------------------
-- Primer administrador: solo funciona si no existe ningún empleado.
-- Se ejecuta una vez desde scripts/bootstrap-admin.mjs (service_role).
-- -----------------------------------------------------------------------------
create or replace function public.bootstrap_admin(p_code text, p_name text, p_pin text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if exists (select 1 from public.employees) then
    raise exception 'Ya existen empleados; use la aplicación para crear más' using errcode = '42501';
  end if;
  perform app.validate_pin(p_pin);
  insert into public.employees(employee_code, full_name, role_id, job_title)
  values (upper(trim(p_code)), trim(p_name), 'admin', 'Administrador') returning id into v_id;
  insert into public.employee_credentials(employee_id, pin_hash)
  values (v_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)));
  return v_id;
end $$;
revoke execute on function public.bootstrap_admin(text, text, text) from public, anon, authenticated;
