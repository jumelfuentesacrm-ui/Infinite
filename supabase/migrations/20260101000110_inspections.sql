-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- MÓDULO · Inspecciones diarias
-- Depende de: core. Inmutables: una inspección nunca sobrescribe otra.
-- =============================================================================
insert into public.app_modules (id, name) values ('inspections', 'Inspecciones') on conflict (id) do nothing;

insert into public.app_settings (key, value) values
  ('inspections', '{"deadline_time": "08:00", "require_photo_on_fail": false}')
on conflict (key) do nothing;

-- Plantillas personalizables por modelo o tipo de vehículo
create table public.inspection_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  model_id     uuid references public.vehicle_models(id),  -- null = aplica por tipo o a todos
  vehicle_type text,
  is_default   boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

create table public.inspection_template_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.inspection_templates(id),
  position     int  not null default 0,
  category     text,
  label        text not null,
  help_text    text,
  is_critical  boolean not null default false,     -- "no conforme" deja el vehículo no apto
  photo_required_on_fail boolean not null default false,
  archived_at  timestamptz
);
create index inspection_template_items_template_idx on public.inspection_template_items(template_id, position);

create table public.inspections (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id),
  employee_id  uuid not null references public.employees(id),
  template_id  uuid not null references public.inspection_templates(id),
  completed_at timestamptz not null default now(),
  result       text not null check (result in ('pass','pass_with_issues','fail')),
  engine_hours numeric(10,1),
  mileage      numeric(10,1),
  fuel_level   text check (fuel_level in ('empty','quarter','half','three_quarters','full')),
  notes        text,
  marked_unfit boolean not null default false,
  lat          double precision,
  lng          double precision,
  reviewed_by  uuid references public.employees(id),
  reviewed_at  timestamptz,
  review_notes text,
  created_at   timestamptz not null default now()
);
create index inspections_vehicle_idx on public.inspections(vehicle_id, completed_at desc);
create index inspections_employee_idx on public.inspections(employee_id, completed_at desc);
create index inspections_completed_idx on public.inspections(completed_at desc);

create table public.inspection_results (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id),
  item_id       uuid references public.inspection_template_items(id),
  label         text not null,               -- copia: el historial no cambia si se edita la plantilla
  category      text,
  is_critical   boolean not null default false,
  result        text not null check (result in ('ok','fail','na')),
  comment       text
);
create index inspection_results_inspection_idx on public.inspection_results(inspection_id);

-- Plantilla base con los puntos solicitados
do $$
declare t uuid;
begin
  insert into public.inspection_templates (name, is_default) values ('Inspección diaria estándar', true) returning id into t;
  insert into public.inspection_template_items (template_id, position, category, label, is_critical) values
    (t, 1,  'Seguridad', 'Frenos', true),
    (t, 2,  'Seguridad', 'Luces', false),
    (t, 3,  'Rodaje',    'Neumáticos', true),
    (t, 4,  'Rodaje',    'Dirección', true),
    (t, 5,  'Rodaje',    'Suspensión', false),
    (t, 6,  'Seguridad', 'Bocina', false),
    (t, 7,  'Seguridad', 'Espejos', false),
    (t, 8,  'Seguridad', 'Cinturones de seguridad', true),
    (t, 9,  'General',   'Condición general', false),
    (t, 10, 'Motor',     'Fugas de líquidos', true),
    (t, 11, 'Motor',     'Nivel de combustible', false),
    (t, 12, 'General',   'Daños visibles', false);
end $$;

-- Plantilla que aplica a un vehículo: modelo > tipo > predeterminada
create or replace function public.inspection_template_for(p_vehicle uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select t.id from public.inspection_templates t
    join public.vehicles v on v.id = p_vehicle
    join public.vehicle_models m on m.id = v.model_id
   where t.active and (t.model_id = m.id or (t.model_id is null and t.vehicle_type = m.vehicle_type) or t.is_default)
   order by (t.model_id = m.id) desc nulls last, (t.vehicle_type = m.vehicle_type) desc nulls last, t.created_at
   limit 1;
$$;

-- Envío atómico de una inspección completa
-- p_results: [{"item_id": uuid, "result": "ok|fail|na", "comment": text}]
create or replace function public.submit_inspection(
  p_vehicle uuid, p_template uuid, p_results jsonb, p_notes text default null,
  p_engine_hours numeric default null, p_mileage numeric default null, p_fuel_level text default null,
  p_mark_unfit boolean default false, p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := app.current_employee_id();
  v_id uuid; v_fail int; v_crit int; v_result text; v_unit text; v_map jsonb := '{}';
  r jsonb; v_item public.inspection_template_items; v_rid uuid;
begin
  perform app.require_perm('inspections.perform');
  if not app.can_see_vehicle(p_vehicle) then
    raise exception 'No tiene acceso a este vehículo' using errcode = '42501';
  end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) = 0 then
    raise exception 'La inspección no tiene resultados' using errcode = '22023';
  end if;
  -- Todos los puntos activos de la plantilla deben estar evaluados
  if exists (select 1 from public.inspection_template_items i
              where i.template_id = p_template and i.archived_at is null
                and not exists (select 1 from jsonb_array_elements(p_results) x
                                 where (x->>'item_id')::uuid = i.id)) then
    raise exception 'Faltan puntos por evaluar' using errcode = '22023';
  end if;

  insert into public.inspections(vehicle_id, employee_id, template_id, result, engine_hours, mileage,
                                 fuel_level, notes, marked_unfit, lat, lng)
  values (p_vehicle, v_emp, p_template, 'pass', p_engine_hours, p_mileage, p_fuel_level, p_notes,
          coalesce(p_mark_unfit,false), p_lat, p_lng)
  returning id into v_id;

  for r in select * from jsonb_array_elements(p_results) loop
    select * into v_item from public.inspection_template_items
     where id = (r->>'item_id')::uuid and template_id = p_template;
    if v_item.id is null then raise exception 'Punto de inspección inválido' using errcode = '22023'; end if;
    insert into public.inspection_results(inspection_id, item_id, label, category, is_critical, result, comment)
    values (v_id, v_item.id, v_item.label, v_item.category, v_item.is_critical, r->>'result', nullif(r->>'comment',''))
    returning id into v_rid;
    v_map := v_map || jsonb_build_object(v_item.id::text, v_rid);
  end loop;

  select count(*) filter (where result = 'fail'), count(*) filter (where result = 'fail' and is_critical)
    into v_fail, v_crit from public.inspection_results where inspection_id = v_id;
  v_result := case when v_crit > 0 or p_mark_unfit then 'fail' when v_fail > 0 then 'pass_with_issues' else 'pass' end;
  update public.inspections set result = v_result, marked_unfit = (v_crit > 0 or coalesce(p_mark_unfit,false))
   where id = v_id;

  perform app.record_meter(p_vehicle, p_engine_hours, p_mileage, 'inspection', v_id);
  update public.vehicles set last_inspection_at = now() where id = p_vehicle;
  select unit_number into v_unit from public.vehicles where id = p_vehicle;

  perform app.timeline_add(p_vehicle, 'inspections', 'inspection',
    'Inspección ' || case v_result when 'pass' then 'conforme' when 'fail' then 'NO APTO' else 'con observaciones' end,
    'inspection', v_id, jsonb_build_object('fails', v_fail, 'critical', v_crit));

  if v_result = 'fail' then
    update public.vehicles set status = 'out_of_service', status_reason = 'Inspección: no apto para operar'
     where id = p_vehicle;
    perform app.notify(array['admin','supervisor','mechanic'], 'inspections', 'vehicle_unfit',
      'Vehículo ' || v_unit || ' NO APTO para operar',
      v_crit || ' punto(s) crítico(s) no conforme(s) en la inspección.', '/inspecciones/' || v_id,
      'critical', 'inspection', v_id);
  elsif v_result = 'pass_with_issues' then
    perform app.notify(array['admin','supervisor'], 'inspections', 'vehicle_issues',
      'Vehículo ' || v_unit || ' con observaciones', v_fail || ' punto(s) no conforme(s).',
      '/inspecciones/' || v_id, 'warning', 'inspection', v_id);
  end if;

  return jsonb_build_object('id', v_id, 'result', v_result, 'results', v_map);
end $$;

create or replace function public.review_inspection(p_inspection uuid, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('inspections.approve');
  update public.inspections set reviewed_by = app.current_employee_id(), reviewed_at = now(), review_notes = p_notes
   where id = p_inspection;
end $$;

-- Cumplimiento del día: vehículos asignados / en operación y si ya se inspeccionaron
create or replace view public.inspection_compliance_today with (security_invoker = true) as
  with tz as (select coalesce((select value->>'timezone' from public.app_settings where key='company'),'UTC') as z),
  today as (select (now() at time zone (select z from tz))::date as d)
  select v.id as vehicle_id, v.unit_number, v.status,
         a.employee_id, e.full_name as employee_name,
         li.id as inspection_id, li.completed_at, li.result,
         (li.id is not null) as inspected_today
    from public.vehicles v
    left join public.vehicle_assignments a on a.vehicle_id = v.id and a.ended_at is null
    left join public.employees e on e.id = a.employee_id
    left join lateral (
      select i.id, i.completed_at, i.result from public.inspections i
       where i.vehicle_id = v.id
         and (i.completed_at at time zone (select z from tz))::date = (select d from today)
       order by i.completed_at desc limit 1) li on true
   where v.archived_at is null and v.status in ('assigned','in_operation','available')
     and (a.id is not null or v.status = 'in_operation');

-- Alerta: vehículo en operación sin inspección del día
create or replace function app.inspections_on_vehicle_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'in_operation' and old.status is distinct from 'in_operation'
     and app.module_enabled('inspections')
     and (new.last_inspection_at is null or new.last_inspection_at::date < current_date) then
    perform app.notify(array['admin','supervisor'], 'inspections', 'operating_without_inspection',
      'Vehículo ' || new.unit_number || ' en operación sin inspección', 'Comenzó la jornada sin inspección completada.',
      '/flota/' || new.id, 'critical', 'vehicle', new.id,
      'noinsp:' || new.id || ':' || current_date);
  end if;
  return new;
end $$;
create trigger vehicles_inspection_check after update of status on public.vehicles
  for each row execute function app.inspections_on_vehicle_status();

create or replace function app.inspections_alerts()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_deadline time; v_now time; v_tz text; r record;
begin
  select coalesce((value->>'deadline_time')::time, '08:00') into v_deadline from public.app_settings where key='inspections';
  select coalesce(value->>'timezone','UTC') into v_tz from public.app_settings where key='company';
  v_now := (now() at time zone v_tz)::time;
  if v_now < v_deadline then return; end if;
  for r in select * from public.inspection_compliance_today where not inspected_today and employee_id is not null loop
    perform app.notify(array['admin','supervisor'], 'inspections', 'inspection_missing',
      'Inspección pendiente: ' || r.unit_number, coalesce(r.employee_name,'Sin chofer') || ' no ha completado la inspección.',
      '/inspecciones/pendientes', 'warning', 'vehicle', r.vehicle_id,
      'insp_missing:' || r.vehicle_id || ':' || (now() at time zone v_tz)::date);
    perform app.notify_employee(r.employee_id, 'inspections', 'inspection_missing',
      'Complete la inspección de ' || r.unit_number, null, '/m/inspeccion', 'warning', 'vehicle', r.vehicle_id,
      'insp_missing_emp:' || r.vehicle_id || ':' || r.employee_id || ':' || (now() at time zone v_tz)::date);
  end loop;
end $$;
insert into public.alert_jobs values ('inspections', 'inspections_alerts') on conflict do nothing;

-- Permisos
insert into public.permissions (id, module_id, action, label, sort) values
  ('inspections.view',     'inspections', 'view',     'Ver todas las inspecciones', 1),
  ('inspections.view_own', 'inspections', 'view_own', 'Ver sus inspecciones', 2),
  ('inspections.perform',  'inspections', 'perform',  'Realizar inspecciones', 3),
  ('inspections.approve',  'inspections', 'approve',  'Revisar inspecciones', 4),
  ('inspections.manage',   'inspections', 'manage',   'Configurar plantillas', 5)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','inspections.view'), ('supervisor','inspections.view_own'), ('supervisor','inspections.perform'),
  ('supervisor','inspections.approve'),
  ('driver','inspections.view_own'), ('driver','inspections.perform'),
  ('mechanic','inspections.view'), ('mechanic','inspections.view_own')
on conflict do nothing;

-- RLS
alter table public.inspection_templates      enable row level security;
alter table public.inspection_template_items enable row level security;
alter table public.inspections               enable row level security;
alter table public.inspection_results        enable row level security;

create policy insp_templates_read on public.inspection_templates for select to authenticated
  using ((select app.current_employee_id()) is not null);
create policy insp_templates_write on public.inspection_templates for insert to authenticated
  with check ((select app.has_perm('inspections.manage')));
create policy insp_templates_update on public.inspection_templates for update to authenticated
  using ((select app.has_perm('inspections.manage'))) with check ((select app.has_perm('inspections.manage')));
create policy insp_items_read on public.inspection_template_items for select to authenticated
  using ((select app.current_employee_id()) is not null);
create policy insp_items_write on public.inspection_template_items for insert to authenticated
  with check ((select app.has_perm('inspections.manage')));
create policy insp_items_update on public.inspection_template_items for update to authenticated
  using ((select app.has_perm('inspections.manage'))) with check ((select app.has_perm('inspections.manage')));
create policy inspections_read on public.inspections for select to authenticated
  using ((select app.has_perm('inspections.view'))
         or (employee_id = (select app.current_employee_id()) and (select app.has_perm('inspections.view_own'))));
create policy insp_results_read on public.inspection_results for select to authenticated
  using (exists (select 1 from public.inspections i where i.id = inspection_id));
-- Sin INSERT/UPDATE directos: solo por submit_inspection / review_inspection.
revoke insert, update on public.inspections, public.inspection_results from authenticated;

do $$ begin
  perform app.track('public.inspection_templates');
  perform app.track('public.inspection_template_items', false);
  perform app.track('public.inspections', false);
end $$;
