-- @generated por scripts/modules.mjs — edite el archivo fuente, no este.
-- =============================================================================
-- MÓDULO · Operaciones y asignaciones (calendario)
-- Depende de: core. La base de datos impide asignar el mismo vehículo a dos
-- operaciones que se solapen (restricción de exclusión con rangos de tiempo).
-- =============================================================================
insert into public.app_modules (id, name) values ('operations', 'Operaciones') on conflict (id) do nothing;

create table public.operations (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(trim(title)) > 0),
  description   text,
  location_name text,
  lat           double precision,
  lng           double precision,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        text not null default 'scheduled' check (status in ('scheduled','in_progress','completed','cancelled')),
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  check (ends_at > starts_at)
);
create index operations_period_idx on public.operations(starts_at, ends_at);

create table public.operation_vehicles (
  operation_id uuid not null references public.operations(id) on delete cascade,
  vehicle_id   uuid not null references public.vehicles(id),
  period       tstzrange not null,
  active       boolean not null default true,
  primary key (operation_id, vehicle_id),
  constraint operation_vehicle_no_overlap
    exclude using gist (vehicle_id with =, period with &&) where (active)
);

create table public.operation_employees (
  operation_id uuid not null references public.operations(id) on delete cascade,
  employee_id  uuid not null references public.employees(id),
  role         text,
  primary key (operation_id, employee_id)
);
create index operation_employees_employee_idx on public.operation_employees(employee_id);

-- Mantiene el rango de tiempo sincronizado si cambia la operación
create or replace function app.operations_sync_period()
returns trigger language plpgsql as $$
begin
  update public.operation_vehicles
     set period = tstzrange(new.starts_at, new.ends_at, '[)'),
         active = new.status not in ('cancelled','completed')
   where operation_id = new.id;
  return new;
end $$;
create trigger operations_sync after update of starts_at, ends_at, status on public.operations
  for each row execute function app.operations_sync_period();

-- Crea o modifica una operación completa en una sola transacción
-- p: {id?, title, description, location_name, lat, lng, starts_at, ends_at, status, notes,
--     vehicle_ids: [uuid], employees: [{employee_id, role}]}
create or replace function public.save_operation(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_unit text;
begin
  if v_id is null then perform app.require_perm('operations.create');
  else perform app.require_perm('operations.edit'); end if;

  if v_id is null then
    insert into public.operations(title, description, location_name, lat, lng, starts_at, ends_at, status, notes)
    values (p->>'title', p->>'description', p->>'location_name', (p->>'lat')::float8, (p->>'lng')::float8,
            (p->>'starts_at')::timestamptz, (p->>'ends_at')::timestamptz, coalesce(p->>'status','scheduled'), p->>'notes')
    returning id into v_id;
  else
    update public.operations set title = p->>'title', description = p->>'description',
           location_name = p->>'location_name', lat = (p->>'lat')::float8, lng = (p->>'lng')::float8,
           starts_at = (p->>'starts_at')::timestamptz, ends_at = (p->>'ends_at')::timestamptz,
           status = coalesce(p->>'status', status), notes = p->>'notes'
     where id = v_id;
    if not found then raise exception 'Operación no encontrada' using errcode = 'P0002'; end if;
    delete from public.operation_vehicles where operation_id = v_id;
    delete from public.operation_employees where operation_id = v_id;
  end if;

  begin
    insert into public.operation_vehicles(operation_id, vehicle_id, period, active)
    select v_id, x::uuid, tstzrange(o.starts_at, o.ends_at, '[)'), o.status not in ('cancelled','completed')
      from jsonb_array_elements_text(coalesce(p->'vehicle_ids','[]')) x, public.operations o where o.id = v_id;
  exception when exclusion_violation then
    select v.unit_number into v_unit from public.vehicles v
     where v.id in (select x::uuid from jsonb_array_elements_text(p->'vehicle_ids') x)
       and exists (select 1 from public.operation_vehicles ov join public.operations o2 on o2.id = ov.operation_id
                    where ov.vehicle_id = v.id and ov.active and ov.operation_id <> v_id
                      and ov.period && tstzrange((p->>'starts_at')::timestamptz, (p->>'ends_at')::timestamptz, '[)'))
     limit 1;
    raise exception 'El vehículo % ya está asignado a otra operación en ese horario', coalesce(v_unit,'')
      using errcode = '23P01';
  end;

  insert into public.operation_employees(operation_id, employee_id, role)
  select v_id, (x->>'employee_id')::uuid, x->>'role'
    from jsonb_array_elements(coalesce(p->'employees','[]')) x;

  -- Notifica a los empleados asignados
  insert into public.notifications(module_id, type, title, body, link, recipient_employee_id, entity_type, entity_id, dedupe_key)
  select 'operations', 'operation_assigned', 'Nueva asignación: ' || (p->>'title'),
         to_char((p->>'starts_at')::timestamptz, 'DD/MM/YYYY HH24:MI'), '/m/asignaciones', oe.employee_id,
         'operation', v_id, 'op:' || v_id || ':' || oe.employee_id || ':' || (p->>'starts_at')
    from public.operation_employees oe where oe.operation_id = v_id
  on conflict (dedupe_key) do nothing;
  return v_id;
end $$;

create or replace function public.set_operation_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (app.has_perm('operations.edit') or exists
          (select 1 from public.operation_employees where operation_id = p_id and employee_id = app.current_employee_id())) then
    raise exception 'Sin permiso para cambiar esta operación' using errcode = '42501';
  end if;
  update public.operations set status = p_status where id = p_id;
  if p_status = 'in_progress' then
    update public.vehicles set status = 'in_operation'
     where id in (select vehicle_id from public.operation_vehicles where operation_id = p_id)
       and status in ('available','assigned');
  elsif p_status in ('completed','cancelled') then
    update public.vehicles v set status = case when exists
             (select 1 from public.vehicle_assignments a where a.vehicle_id = v.id and a.ended_at is null)
             then 'assigned' else 'available' end
     where id in (select vehicle_id from public.operation_vehicles where operation_id = p_id)
       and status = 'in_operation';
  end if;
end $$;

insert into public.permissions (id, module_id, action, label, sort) values
  ('operations.view',     'operations', 'view',     'Ver calendario de operaciones', 1),
  ('operations.view_own', 'operations', 'view_own', 'Ver sus asignaciones', 2),
  ('operations.create',   'operations', 'create',   'Crear operaciones', 3),
  ('operations.edit',     'operations', 'edit',     'Modificar operaciones', 4)
on conflict (id) do nothing;
insert into public.role_permissions values
  ('supervisor','operations.view'), ('supervisor','operations.view_own'), ('supervisor','operations.create'),
  ('supervisor','operations.edit'), ('driver','operations.view_own'), ('mechanic','operations.view_own')
on conflict do nothing;

alter table public.operations          enable row level security;
alter table public.operation_vehicles  enable row level security;
alter table public.operation_employees enable row level security;

create or replace function app.can_see_operation(p_op uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app.has_perm('operations.view')
      or (app.has_perm('operations.view_own') and exists (select 1 from public.operation_employees
            where operation_id = p_op and employee_id = app.current_employee_id()));
$$;
create policy operations_read on public.operations for select to authenticated using (app.can_see_operation(id));
create policy op_vehicles_read on public.operation_vehicles for select to authenticated using (app.can_see_operation(operation_id));
create policy op_employees_read on public.operation_employees for select to authenticated using (app.can_see_operation(operation_id));
revoke insert, update on public.operations, public.operation_vehicles, public.operation_employees from authenticated;

do $$ begin
  perform app.track('public.operations');
  perform app.track('public.operation_employees', false);
end $$;
