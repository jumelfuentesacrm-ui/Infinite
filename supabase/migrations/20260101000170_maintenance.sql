-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- MÓDULO · Mantenimiento preventivo
-- Depende de: core. Intervalos por MODELO (horas de motor, días y/o millaje).
-- No trae intervalos de fábrica precargados: se configuran desde el manual
-- oficial de cada modelo (campo source_reference).
-- =============================================================================
insert into public.app_modules (id, name) values ('maintenance', 'Mantenimiento') on conflict (id) do nothing;

insert into public.app_settings (key, value) values
  ('maintenance', '{"require_approval": false, "default_warn_hours": 10, "default_warn_days": 14, "default_warn_miles": 100}')
on conflict (key) do nothing;

create table public.maintenance_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
insert into public.maintenance_types (name) values
  ('Cambio de aceite'), ('Filtro de aceite'), ('Filtro de aire'), ('Bujías'), ('Inspección de frenos'),
  ('Inspección de transmisión'), ('Sistema de enfriamiento'), ('Correas'), ('Suspensión'), ('Lubricación');

create table public.maintenance_intervals (
  id                 uuid primary key default gen_random_uuid(),
  model_id           uuid not null references public.vehicle_models(id),
  maintenance_type_id uuid not null references public.maintenance_types(id),
  interval_hours     numeric(10,1) check (interval_hours > 0),
  interval_days      int check (interval_days > 0),
  interval_miles     numeric(10,1) check (interval_miles > 0),
  warn_hours         numeric(10,1),
  warn_days          int,
  warn_miles         numeric(10,1),
  source_reference   text,               -- ej.: "Manual de servicio Outlander 2024, pág. 34"
  notes              text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  unique (model_id, maintenance_type_id),
  check (interval_hours is not null or interval_days is not null or interval_miles is not null)
);

create table public.maintenance_records (
  id                 uuid primary key default gen_random_uuid(),
  vehicle_id         uuid not null references public.vehicles(id),
  maintenance_type_id uuid not null references public.maintenance_types(id),
  interval_id        uuid references public.maintenance_intervals(id),
  status             text not null default 'scheduled' check (status in
                       ('pending_approval','scheduled','in_progress','completed','cancelled')),
  scheduled_for      date,
  responsible_id     uuid references public.employees(id),
  performed_by       uuid references public.employees(id),
  performed_at       timestamptz,
  engine_hours       numeric(10,1),
  mileage            numeric(10,1),
  labor_hours        numeric(8,2),
  cost_labor         numeric(12,2),
  cost_parts         numeric(12,2),
  next_due_date      date,
  next_due_hours     numeric(10,1),
  next_due_miles     numeric(10,1),
  work_order_id      uuid,               -- enlace blando al módulo Taller (si está instalado)
  notes              text,
  approved_by        uuid references public.employees(id),
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
create index maintenance_records_vehicle_idx on public.maintenance_records(vehicle_id, performed_at desc);
create index maintenance_records_status_idx on public.maintenance_records(status);

-- Piezas requeridas (texto libre; enlace blando a inventario si existe)
create table public.maintenance_record_parts (
  id                uuid primary key default gen_random_uuid(),
  record_id         uuid not null references public.maintenance_records(id),
  description       text not null,
  part_number       text,
  quantity          numeric(10,2) not null default 1 check (quantity > 0),
  inventory_item_id uuid
);

-- Estado de mantenimiento de cada vehículo × intervalo de su modelo
create or replace view public.maintenance_due with (security_invoker = true) as
with cfg as (select value from public.app_settings where key = 'maintenance'),
base as (
  select v.id as vehicle_id, v.unit_number, v.engine_hours as current_hours, v.mileage as current_miles,
         mi.id as interval_id, mi.maintenance_type_id, mt.name as type_name,
         mi.interval_hours, mi.interval_days, mi.interval_miles,
         coalesce(mi.warn_hours, ((select value from cfg)->>'default_warn_hours')::numeric, 10) as warn_hours,
         coalesce(mi.warn_days,  ((select value from cfg)->>'default_warn_days')::int, 14)      as warn_days,
         coalesce(mi.warn_miles, ((select value from cfg)->>'default_warn_miles')::numeric, 100) as warn_miles,
         last.performed_at as last_done_at, last.engine_hours as last_done_hours, last.mileage as last_done_miles,
         coalesce(last.performed_at::date, v.acquired_at, v.created_at::date) as base_date,
         open_rec.id as open_record_id, open_rec.status as open_record_status
    from public.vehicles v
    join public.maintenance_intervals mi on mi.model_id = v.model_id and mi.active
    join public.maintenance_types mt on mt.id = mi.maintenance_type_id
    left join lateral (select r.performed_at, r.engine_hours, r.mileage from public.maintenance_records r
                        where r.vehicle_id = v.id and r.maintenance_type_id = mi.maintenance_type_id and r.status = 'completed'
                        order by r.performed_at desc limit 1) last on true
    left join lateral (select r.id, r.status from public.maintenance_records r
                        where r.vehicle_id = v.id and r.maintenance_type_id = mi.maintenance_type_id
                          and r.status in ('pending_approval','scheduled','in_progress')
                        order by r.created_at desc limit 1) open_rec on true
   where v.archived_at is null and v.status <> 'retired')
select b.*,
       case when b.interval_hours is not null then coalesce(b.last_done_hours, 0) + b.interval_hours end as due_hours,
       case when b.interval_days  is not null then b.base_date + b.interval_days end as due_date,
       case when b.interval_miles is not null then coalesce(b.last_done_miles, 0) + b.interval_miles end as due_miles,
       case
         when (b.interval_hours is not null and b.current_hours >= coalesce(b.last_done_hours,0) + b.interval_hours)
           or (b.interval_days is not null and current_date >= b.base_date + b.interval_days)
           or (b.interval_miles is not null and b.current_miles >= coalesce(b.last_done_miles,0) + b.interval_miles)
           then 'overdue'
         when (b.interval_hours is not null and b.current_hours >= coalesce(b.last_done_hours,0) + b.interval_hours - b.warn_hours)
           or (b.interval_days is not null and current_date >= b.base_date + b.interval_days - b.warn_days)
           or (b.interval_miles is not null and b.current_miles >= coalesce(b.last_done_miles,0) + b.interval_miles - b.warn_miles)
           then 'due_soon'
         else 'ok' end as due_status
  from base b;

-- Recalcula el resumen "próximo mantenimiento" del expediente del vehículo
create or replace function app.maintenance_refresh_vehicle(p_vehicle uuid)
returns void language sql security definer set search_path = public as $$
  update public.vehicles v set
    next_maintenance_at    = (select min(d.due_date)  from public.maintenance_due d where d.vehicle_id = p_vehicle),
    next_maintenance_hours = (select min(d.due_hours) from public.maintenance_due d where d.vehicle_id = p_vehicle)
  where v.id = p_vehicle;
$$;

create or replace function app.maintenance_on_meter()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.engine_hours is distinct from old.engine_hours or new.mileage is distinct from old.mileage then
    perform app.maintenance_refresh_vehicle(new.id);
  end if;
  return new;
end $$;
create trigger vehicles_maintenance_refresh after update of engine_hours, mileage on public.vehicles
  for each row when (pg_trigger_depth() < 2) execute function app.maintenance_on_meter();

-- Programar mantenimiento (queda pendiente de aprobación si así se configura)
create or replace function public.schedule_maintenance(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_need_approval boolean; v_unit text; v_type text;
begin
  perform app.require_perm('maintenance.create');
  select coalesce((value->>'require_approval')::boolean, false) into v_need_approval
    from public.app_settings where key = 'maintenance';
  insert into public.maintenance_records(vehicle_id, maintenance_type_id, interval_id, status, scheduled_for,
                                         responsible_id, notes)
  values ((p->>'vehicle_id')::uuid, (p->>'maintenance_type_id')::uuid,
          (select id from public.maintenance_intervals mi where mi.maintenance_type_id = (p->>'maintenance_type_id')::uuid
              and mi.model_id = (select model_id from public.vehicles where id = (p->>'vehicle_id')::uuid)),
          case when v_need_approval and not app.has_perm('maintenance.approve') then 'pending_approval' else 'scheduled' end,
          (p->>'scheduled_for')::date, nullif(p->>'responsible_id','')::uuid, p->>'notes')
  returning id into v_id;

  insert into public.maintenance_record_parts(record_id, description, part_number, quantity, inventory_item_id)
  select v_id, x->>'description', x->>'part_number', coalesce((x->>'quantity')::numeric, 1), nullif(x->>'inventory_item_id','')::uuid
    from jsonb_array_elements(coalesce(p->'parts','[]')) x where coalesce(x->>'description','') <> '';

  if exists (select 1 from public.maintenance_records where id = v_id and status = 'pending_approval') then
    select v.unit_number, t.name into v_unit, v_type from public.vehicles v, public.maintenance_types t
     where v.id = (p->>'vehicle_id')::uuid and t.id = (p->>'maintenance_type_id')::uuid;
    perform app.notify(array['admin','supervisor'], 'maintenance', 'approval_needed',
      'Mantenimiento por aprobar: ' || v_unit, v_type, '/mantenimiento/' || v_id, 'info', 'maintenance_record', v_id);
  end if;
  if (p->>'responsible_id') is not null and (p->>'responsible_id') <> '' then
    perform app.notify_employee((p->>'responsible_id')::uuid, 'maintenance', 'assigned',
      'Mantenimiento asignado', null, '/mantenimiento/' || v_id, 'info', 'maintenance_record', v_id);
  end if;
  return v_id;
end $$;

create or replace function public.approve_maintenance(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.require_perm('maintenance.approve');
  update public.maintenance_records
     set status = case when p_approve then 'scheduled' else 'cancelled' end,
         approved_by = app.current_employee_id(), approved_at = now()
   where id = p_id and status = 'pending_approval';
  if not found then raise exception 'El mantenimiento no está pendiente de aprobación' using errcode = 'P0002'; end if;
end $$;

create or replace function public.start_maintenance(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_vehicle uuid;
begin
  perform app.require_perm('maintenance.perform');
  update public.maintenance_records set status = 'in_progress' where id = p_id and status = 'scheduled'
  returning vehicle_id into v_vehicle;
  if v_vehicle is null then raise exception 'Solo se puede iniciar un mantenimiento programado' using errcode = '22023'; end if;
  update public.vehicles set status = 'maintenance', status_reason = 'Mantenimiento en curso'
   where id = v_vehicle and status in ('available','assigned');
end $$;

-- Completar: actualiza horas, historial, próximo vencimiento y estado del vehículo
-- p: {performed_at?, engine_hours, mileage, labor_hours, cost_labor, cost_parts, notes, performed_by?}
create or replace function public.complete_maintenance(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.maintenance_records; i public.maintenance_intervals; v public.vehicles; v_type text;
  v_at timestamptz := least(coalesce((p->>'performed_at')::timestamptz, now()), now());
  v_hours numeric; v_miles numeric;
begin
  perform app.require_perm('maintenance.perform');
  select * into r from public.maintenance_records where id = p_id for update;
  if r.id is null then raise exception 'Mantenimiento no encontrado' using errcode = 'P0002'; end if;
  if r.status not in ('scheduled','in_progress') then
    raise exception 'Este mantenimiento no se puede completar (estado: %)', r.status using errcode = '22023';
  end if;
  perform app.record_meter(r.vehicle_id, (p->>'engine_hours')::numeric, (p->>'mileage')::numeric, 'maintenance', r.id);
  select * into v from public.vehicles where id = r.vehicle_id;
  v_hours := coalesce((p->>'engine_hours')::numeric, v.engine_hours);
  v_miles := coalesce((p->>'mileage')::numeric, v.mileage);
  select * into i from public.maintenance_intervals where id = r.interval_id
     or (model_id = v.model_id and maintenance_type_id = r.maintenance_type_id) limit 1;

  update public.maintenance_records set status = 'completed', performed_at = v_at,
         performed_by = coalesce(nullif(p->>'performed_by','')::uuid, app.current_employee_id()),
         engine_hours = v_hours, mileage = v_miles,
         labor_hours = (p->>'labor_hours')::numeric, cost_labor = (p->>'cost_labor')::numeric,
         cost_parts = (p->>'cost_parts')::numeric, notes = coalesce(p->>'notes', notes), interval_id = i.id,
         next_due_hours = case when i.interval_hours is not null then v_hours + i.interval_hours end,
         next_due_miles = case when i.interval_miles is not null and v_miles is not null then v_miles + i.interval_miles end,
         next_due_date  = case when i.interval_days is not null then v_at::date + i.interval_days end
   where id = p_id;

  update public.vehicles set last_maintenance_at = v_at,
         status = case when status = 'maintenance' then
                    case when exists (select 1 from public.vehicle_assignments a where a.vehicle_id = r.vehicle_id and a.ended_at is null)
                         then 'assigned' else 'available' end else status end,
         status_reason = case when status = 'maintenance' then null else status_reason end
   where id = r.vehicle_id;
  perform app.maintenance_refresh_vehicle(r.vehicle_id);

  select name into v_type from public.maintenance_types where id = r.maintenance_type_id;
  perform app.timeline_add(r.vehicle_id, 'maintenance', 'maintenance', 'Mantenimiento: ' || v_type,
    'maintenance_record', r.id,
    jsonb_build_object('engine_hours', v_hours, 'parts', (select coalesce(jsonb_agg(jsonb_build_object(
        'description', description, 'part_number', part_number, 'quantity', quantity)), '[]')
        from public.maintenance_record_parts where record_id = r.id)),
    coalesce((p->>'cost_labor')::numeric,0) + coalesce((p->>'cost_parts')::numeric,0),
    (p->>'labor_hours')::numeric, v_at);
end $$;

-- Alertas: próximos / vencidos (una por semana por vehículo y tipo)
create or replace function app.maintenance_alerts()
returns void language plpgsql security definer set search_path = public as $$
declare d record;
begin
  for d in select * from public.maintenance_due where due_status in ('due_soon','overdue') and open_record_id is null loop
    perform app.notify(array['admin','supervisor','mechanic'], 'maintenance', 'maintenance_' || d.due_status,
      case d.due_status when 'overdue' then 'Mantenimiento VENCIDO: ' else 'Mantenimiento próximo: ' end
        || d.unit_number || ' · ' || d.type_name,
      concat_ws(' · ', case when d.due_hours is not null then 'a las ' || d.due_hours || ' h (actual ' || d.current_hours || ' h)' end,
                       case when d.due_date is not null then 'fecha ' || to_char(d.due_date, 'DD/MM/YYYY') end),
      '/mantenimiento?vehiculo=' || d.vehicle_id,
      case d.due_status when 'overdue' then 'critical' else 'warning' end, 'vehicle', d.vehicle_id,
      'mnt:' || d.due_status || ':' || d.vehicle_id || ':' || d.interval_id || ':' || to_char(current_date, 'IYYY-IW'));
  end loop;
  for d in select r.id, v.unit_number from public.maintenance_records r join public.vehicles v on v.id = r.vehicle_id
            where r.status = 'scheduled' and r.scheduled_for < current_date loop
    perform app.notify(array['admin','supervisor'], 'maintenance', 'maintenance_pending',
      'Mantenimiento programado sin realizar: ' || d.unit_number, null, '/mantenimiento/' || d.id, 'warning',
      'maintenance_record', d.id, 'mnt_pending:' || d.id || ':' || current_date);
  end loop;
end $$;
insert into public.alert_jobs values ('maintenance', 'maintenance_alerts') on conflict do nothing;

insert into public.permissions (id, module_id, action, label, sort) values
  ('maintenance.view',    'maintenance', 'view',    'Ver mantenimientos', 1),
  ('maintenance.create',  'maintenance', 'create',  'Programar mantenimientos', 2),
  ('maintenance.perform', 'maintenance', 'perform', 'Iniciar y completar mantenimientos', 3),
  ('maintenance.approve', 'maintenance', 'approve', 'Aprobar mantenimientos', 4),
  ('maintenance.manage',  'maintenance', 'manage',  'Configurar tipos e intervalos por modelo', 5)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','maintenance.view'), ('supervisor','maintenance.create'), ('supervisor','maintenance.approve'),
  ('mechanic','maintenance.view'), ('mechanic','maintenance.create'), ('mechanic','maintenance.perform')
on conflict do nothing;

alter table public.maintenance_types        enable row level security;
alter table public.maintenance_intervals    enable row level security;
alter table public.maintenance_records      enable row level security;
alter table public.maintenance_record_parts enable row level security;
create policy mnt_types_read on public.maintenance_types for select to authenticated using ((select app.current_employee_id()) is not null);
create policy mnt_types_insert on public.maintenance_types for insert to authenticated with check ((select app.has_perm('maintenance.manage')));
create policy mnt_types_update on public.maintenance_types for update to authenticated
  using ((select app.has_perm('maintenance.manage'))) with check ((select app.has_perm('maintenance.manage')));
create policy mnt_int_read on public.maintenance_intervals for select to authenticated using ((select app.has_perm('maintenance.view')));
create policy mnt_int_insert on public.maintenance_intervals for insert to authenticated with check ((select app.has_perm('maintenance.manage')));
create policy mnt_int_update on public.maintenance_intervals for update to authenticated
  using ((select app.has_perm('maintenance.manage'))) with check ((select app.has_perm('maintenance.manage')));
create policy mnt_rec_read on public.maintenance_records for select to authenticated using ((select app.has_perm('maintenance.view')));
create policy mnt_parts_read on public.maintenance_record_parts for select to authenticated using ((select app.has_perm('maintenance.view')));
create policy mnt_parts_insert on public.maintenance_record_parts for insert to authenticated with check ((select app.has_perm('maintenance.create')));
revoke insert, update on public.maintenance_records from authenticated;
grant update (scheduled_for, responsible_id, notes) on public.maintenance_records to authenticated;
create policy mnt_rec_update on public.maintenance_records for update to authenticated
  using ((select app.has_perm('maintenance.create'))) with check ((select app.has_perm('maintenance.create')));

do $$ begin
  perform app.track('public.maintenance_types', false);
  perform app.track('public.maintenance_intervals');
  perform app.track('public.maintenance_records');
end $$;
