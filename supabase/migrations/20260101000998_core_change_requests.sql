-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- CORE · Solicitudes de cambio (se aplica DESPUÉS de los módulos)
-- Regla: lo que ya se guardó solo lo modifica el administrador.
-- Cualquier otro empleado puede abrir el formulario y cambiar campos; al guardar
-- se crea una solicitud que el admin aprueba (se aplica) o rechaza.
-- Añadir cosas nuevas (piezas, órdenes, trabajos realizados) sigue permitido.
-- Es idempotente: se vuelve a aplicar al instalar módulos nuevos.
-- =============================================================================

-- Nombres de roles
update public.roles set name = 'Admin',      description = 'Acceso completo; ve quién hizo cada cosa y aprueba cambios' where id = 'admin';
update public.roles set name = 'Supervisor', description = 'Supervisa el taller y la flota'                             where id = 'supervisor';
update public.roles set name = 'Mecánico',   description = 'Registra piezas, mantenimientos y reparaciones'            where id = 'mechanic';
update public.roles set name = 'ATV/UTV',    description = 'Opera las unidades y reporta problemas'                    where id = 'driver';

-- Tablas protegidas: etiqueta, columna que identifica el registro, permiso para pedir cambios y enlace
create table if not exists app.change_guarded (
  table_name text primary key,          -- 'public.vehicles'
  label      text not null,
  label_col  text,
  view_perm  text,
  link       text                       -- '/flota/{id}'
);

insert into app.change_guarded values
  ('public.vehicles',                  'Vehículo',              'unit_number',  'fleet.view',        '/flota/{id}'),
  ('public.vehicle_models',            'Modelo de vehículo',    'model',        'fleet.view',        '/flota/modelos'),
  ('public.employees',                 'Empleado',              'full_name',    'employees.view',    '/empleados/{id}'),
  ('public.inventory_items',           'Pieza de inventario',   'name',         'inventory.view',    '/inventario/{id}'),
  ('public.suppliers',                 'Proveedor',             'name',         'inventory.view',    '/inventario/proveedores'),
  ('public.work_orders',               'Orden de trabajo',      'order_number', 'workorders.view',   '/taller/{id}'),
  ('public.maintenance_records',       'Mantenimiento',         null,           'maintenance.view',  '/mantenimiento/{id}'),
  ('public.maintenance_intervals',     'Intervalo de mantenimiento', null,      'maintenance.view',  '/mantenimiento'),
  ('public.maintenance_types',         'Tipo de mantenimiento', 'name',         'maintenance.view',  '/mantenimiento'),
  ('public.inspection_templates',      'Plantilla de inspección', 'name',       'inspections.view',  '/inspecciones'),
  ('public.inspection_template_items', 'Punto de inspección',   'label',        'inspections.view',  '/inspecciones'),
  ('public.documents',                 'Documento',             'title',        'documents.view',    '/documentos/{id}'),
  ('public.fuel_logs',                 'Combustible',           null,           'fuel.view',         '/combustible'),
  ('public.incidents',                 'Incidente',             null,           'accidents.view',    '/incidentes/{id}'),
  ('public.manuals',                   'Manual',                'title',        'parts_catalog.view','/catalogo/manuales'),
  ('public.catalog_parts',             'Pieza OEM',             'part_number',  'parts_catalog.view','/catalogo')
on conflict (table_name) do update set label = excluded.label, label_col = excluded.label_col,
  view_perm = excluded.view_perm, link = excluded.link;
-- Solo las tablas que existen en esta instalación (módulos no instalados se omiten)
delete from app.change_guarded where to_regclass(table_name) is null;

create table if not exists public.change_requests (
  id             uuid primary key default gen_random_uuid(),
  table_name     text not null,
  record_id      uuid not null,
  record_label   text,
  link           text,
  changes        jsonb not null,          -- {columna: valor nuevo}
  previous       jsonb not null,          -- {columna: valor anterior}
  reason         text,
  status         text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by   uuid not null references public.employees(id),
  requested_at   timestamptz not null default now(),
  decided_by     uuid references public.employees(id),
  decided_at     timestamptz,
  decision_notes text
);
create index if not exists change_requests_pending_idx on public.change_requests(requested_at desc) where status = 'pending';
create index if not exists change_requests_record_idx on public.change_requests(table_name, record_id);

alter table public.change_requests enable row level security;
drop policy if exists change_requests_read on public.change_requests;
create policy change_requests_read on public.change_requests for select to authenticated
  using ((select app.current_role_id()) = 'admin' or requested_by = (select app.current_employee_id()));
revoke insert, update, delete on public.change_requests from anon, authenticated;
revoke all on public.change_requests from anon;

-- Columnas que nunca se cambian por solicitud
create or replace function app.change_protected_col(p_col text)
returns boolean language sql immutable as $$
  select p_col in ('id','created_at','created_by','updated_at','updated_by','auth_user_id','role_id',
                   'last_login_at','order_number','quantity_on_hand','quantity_reserved','balance_after');
$$;

-- Bloquea UPDATE directo desde la API a quien no sea admin.
-- Las funciones del sistema (security definer) no pasan por aquí: su usuario no es 'authenticated'.
create or replace function app.guard_direct_update()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and coalesce(app.current_role_id(), '') <> 'admin' then
    raise exception 'Solo el administrador puede modificar información guardada. Envíe una solicitud de cambio.'
      using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare g record;
begin
  for g in select table_name from app.change_guarded loop
    execute format('drop trigger if exists zz_guard_update on %s', g.table_name);
    execute format('create trigger zz_guard_update before update on %s for each row execute function app.guard_direct_update()',
                   g.table_name);
  end loop;
end $$;

-- Pedir un cambio. Devuelve el id de la solicitud.
create or replace function public.request_change(p_table text, p_id uuid, p_changes jsonb, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  g app.change_guarded; v_emp uuid := app.current_employee_id(); v_old jsonb; v_new jsonb := '{}'; v_prev jsonb := '{}';
  k text; v_label text; v_id uuid; v_name text; v_tbl text := case when p_table like '%.%' then p_table else 'public.' || p_table end;
begin
  if v_emp is null then raise exception 'Sesión no válida' using errcode = '42501'; end if;
  select * into g from app.change_guarded where table_name = v_tbl;
  if g.table_name is null then raise exception 'Este dato no admite solicitudes de cambio' using errcode = '22023'; end if;
  if g.view_perm is not null and not app.has_perm(g.view_perm) then
    raise exception 'Permiso requerido: %', g.view_perm using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) <> 'object' then raise exception 'Cambios no válidos' using errcode = '22023'; end if;

  execute format('select to_jsonb(t) from %s t where id = $1', v_tbl) into v_old using p_id;
  if v_old is null then raise exception 'Registro no encontrado' using errcode = 'P0002'; end if;

  for k in select jsonb_object_keys(p_changes) loop
    continue when app.change_protected_col(k) or not (v_old ? k);
    -- Columnas que el rol de la API no puede leer (p. ej. costos) no se piden por aquí
    continue when not has_column_privilege('authenticated', v_tbl, k, 'SELECT');
    if (v_old -> k) is distinct from (p_changes -> k) then
      v_new  := v_new  || jsonb_build_object(k, p_changes -> k);
      v_prev := v_prev || jsonb_build_object(k, v_old -> k);
    end if;
  end loop;
  if v_new = '{}' then raise exception 'No hay cambios que enviar' using errcode = '22023'; end if;

  v_label := coalesce(v_old ->> g.label_col, g.label);
  insert into public.change_requests(table_name, record_id, record_label, link, changes, previous, reason, requested_by)
  values (v_tbl, p_id, v_label, replace(g.link, '{id}', p_id::text), v_new, v_prev, nullif(trim(coalesce(p_reason, '')), ''), v_emp)
  returning id into v_id;

  select full_name into v_name from public.employees where id = v_emp;
  perform app.notify(array['admin'], 'settings', 'change_request', 'Solicitud de cambio · ' || g.label || ' ' || v_label,
    v_name || ' pide cambiar ' || (select string_agg(x, ', ') from jsonb_object_keys(v_new) x), '/solicitudes', 'warning',
    'change_request', v_id);
  return v_id;
end $$;

-- Aprobar (aplica el cambio) o rechazar. Solo admin.
create or replace function public.decide_change_request(p_id uuid, p_approve boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.change_requests; v_cols text; v_vals text;
begin
  if coalesce(app.current_role_id(), '') <> 'admin' then
    raise exception 'Solo el administrador decide las solicitudes' using errcode = '42501';
  end if;
  select * into r from public.change_requests where id = p_id for update;
  if r.id is null then raise exception 'Solicitud no encontrada' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'La solicitud ya fue atendida' using errcode = '22023'; end if;

  if p_approve then
    select string_agg(quote_ident(k), ', '), string_agg('r.' || quote_ident(k), ', ')
      into v_cols, v_vals from jsonb_object_keys(r.changes) k;
    execute format('update %s t set (%s) = (select %s from jsonb_populate_record(null::%s, $1) r) where t.id = $2',
                   r.table_name, v_cols, v_vals, r.table_name)
      using r.changes, r.record_id;
  end if;

  update public.change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = app.current_employee_id(), decided_at = now(), decision_notes = nullif(trim(coalesce(p_notes, '')), '')
   where id = p_id;

  perform app.notify_employee(r.requested_by, 'settings', 'change_request_decided',
    case when p_approve then 'Cambio aprobado · ' else 'Cambio rechazado · ' end || coalesce(r.record_label, ''),
    p_notes, r.link, case when p_approve then 'info' else 'warning' end, 'change_request', r.id);
end $$;

create or replace function public.cancel_change_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.change_requests set status = 'cancelled', decided_at = now()
   where id = p_id and status = 'pending' and requested_by = app.current_employee_id();
  if not found then raise exception 'Solicitud no encontrada' using errcode = 'P0002'; end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'change_requests')
     and exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.change_requests';
  end if;
end $$;

-- =============================================================================
-- Flota: los mecánicos añaden vehículos (no los archivan).
-- El número de vehículo no se repite (sin importar mayúsculas ni espacios).
-- Sobrescribir un vehículo existente = solicitud que aprueba el admin o un supervisor.
-- =============================================================================
insert into public.permissions (id, module_id, action, label, sort) values
  ('fleet.review_changes', 'fleet', 'review_changes', 'Aprobar solicitudes de cambio de vehículos', 8)
on conflict (id) do nothing;
insert into public.role_permissions values ('mechanic', 'fleet.create'), ('supervisor', 'fleet.review_changes')
on conflict do nothing;
delete from public.role_permissions where role_id = 'mechanic' and permission_id = 'fleet.delete';

create or replace function app.vehicle_unit_clean()
returns trigger language plpgsql as $$
begin
  new.unit_number := regexp_replace(trim(new.unit_number), '\s+', ' ', 'g');
  return new;
end $$;
drop trigger if exists aa_unit_clean on public.vehicles;
create trigger aa_unit_clean before insert or update of unit_number on public.vehicles
  for each row execute function app.vehicle_unit_clean();
create unique index if not exists vehicles_unit_number_ci on public.vehicles (lower(unit_number));

-- ¿Ya existe ese número? Devuelve el vehículo (o null) para ofrecer la solicitud de cambio.
create or replace function public.vehicle_by_unit(p_unit text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (app.has_perm('fleet.create') or app.has_perm('fleet.view')) then
    raise exception 'Permiso requerido: fleet.create' using errcode = '42501';
  end if;
  select jsonb_build_object('id', id, 'unit_number', unit_number, 'archived', archived_at is not null) into v
    from public.vehicles where lower(unit_number) = lower(regexp_replace(trim(coalesce(p_unit, '')), '\s+', ' ', 'g'));
  return v;
end $$;

-- Quién puede decidir una solicitud: el admin siempre; para vehículos también quien tenga
-- fleet.review_changes (supervisor), pero nunca su propia solicitud.
create or replace function app.can_decide_change(p_table text, p_requested_by uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app.current_role_id(), '') = 'admin'
      or (p_table = 'public.vehicles' and app.has_perm('fleet.review_changes')
          and p_requested_by is distinct from app.current_employee_id());
$$;

drop policy if exists change_requests_read on public.change_requests;
create policy change_requests_read on public.change_requests for select to authenticated
  using ((select app.current_role_id()) = 'admin' or requested_by = (select app.current_employee_id())
         or (table_name = 'public.vehicles' and (select app.has_perm('fleet.review_changes'))));

create or replace function public.decide_change_request(p_id uuid, p_approve boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.change_requests; v_cols text; v_vals text;
begin
  select * into r from public.change_requests where id = p_id for update;
  if r.id is null then raise exception 'Solicitud no encontrada' using errcode = 'P0002'; end if;
  if not app.can_decide_change(r.table_name, r.requested_by) then
    raise exception 'No puede decidir esta solicitud' using errcode = '42501';
  end if;
  if r.status <> 'pending' then raise exception 'La solicitud ya fue atendida' using errcode = '22023'; end if;

  if p_approve then
    select string_agg(quote_ident(k), ', '), string_agg('r.' || quote_ident(k), ', ')
      into v_cols, v_vals from jsonb_object_keys(r.changes) k;
    execute format('update %s t set (%s) = (select %s from jsonb_populate_record(null::%s, $1) r) where t.id = $2',
                   r.table_name, v_cols, v_vals, r.table_name)
      using r.changes, r.record_id;
  end if;

  update public.change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = app.current_employee_id(), decided_at = now(), decision_notes = nullif(trim(coalesce(p_notes, '')), '')
   where id = p_id;

  perform app.notify_employee(r.requested_by, 'settings', 'change_request_decided',
    case when p_approve then 'Cambio aprobado · ' else 'Cambio rechazado · ' end || coalesce(r.record_label, ''),
    p_notes, r.link, case when p_approve then 'info' else 'warning' end, 'change_request', r.id);
end $$;

-- Las solicitudes de vehículos también avisan a los supervisores
create or replace function app.notify_vehicle_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.table_name = 'public.vehicles' then
    select full_name into v_name from public.employees where id = new.requested_by;
    perform app.notify(array['supervisor'], 'settings', 'change_request', 'Solicitud de cambio · Vehículo ' || coalesce(new.record_label, ''),
      coalesce(v_name, 'Un empleado') || ' pide cambiar ' || (select string_agg(x, ', ') from jsonb_object_keys(new.changes) x),
      '/solicitudes', 'warning', 'change_request', new.id);
  end if;
  return new;
end $$;
drop trigger if exists notify_vehicle_request on public.change_requests;
create trigger notify_vehicle_request after insert on public.change_requests
  for each row execute function app.notify_vehicle_request();
